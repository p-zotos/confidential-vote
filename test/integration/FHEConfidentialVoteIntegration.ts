import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { FHEConfidentialVote, FHEConfidentialVote__factory } from "../../types";
import { expect } from "chai";
import {
  deployFixture,
  encryptProposalId,
  Signers,
  Proposal,
  Stage,
  REGISTRATION_FEE,
  INSUFFICIENT_FEE,
  NUM_PROPOSALS
} from "../helpers/FHEConfidentialVoteHelper";

describe("FHEConfidentialVote Integration Tests", function () {
    let signers: Signers;
    let contract: FHEConfidentialVote;
    let contractAddress: string;

    before(async function () {
        const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
        signers = {
            owner: ethSigners[0],
            voter1: ethSigners[1],
            voter2: ethSigners[2],
            voter3: ethSigners[3],
        };
    });

    beforeEach(async function () {
        if (!fhevm.isMock) {
            console.warn("Integration tests are designed for FHEVM environment");
            this.skip();
        }
        ({ contract, contractAddress } = await deployFixture());
    });

    // =========================================================================
    //                            STAGE: REGISTRATION
    // =========================================================================
    describe("Stage: Registration", function () {
        it("Reverts if a registered voter tries to register again", async function () {
            await contract.connect(signers.voter1).register({ value: REGISTRATION_FEE });
            await expect(
            contract.connect(signers.voter1).register({ value: REGISTRATION_FEE }),
            ).to.be.revertedWith("Already registered");
        });
        it("Reverts if a voter sends insufficient Ether", async function () {
            await expect(
                contract.connect(signers.voter1).register({ value: INSUFFICIENT_FEE }),
            ).to.be.revertedWith("Insufficient Ether sent");
        });
        it("Reverts if contract owner tries to register", async function () {
            await expect(
                contract.connect(signers.owner).register({ value: REGISTRATION_FEE }),
            ).to.be.revertedWith("Contract owner cannot perform this action");
        });

        it("User tries to register to Vote stage", async function () {
            await contract.connect(signers.owner).advanceStage();
            await expect(
                contract.connect(signers.voter1).register({ value: INSUFFICIENT_FEE }),
            ).to.be.revertedWith("Not in registration stage");
        });
    });

    // =========================================================================
    //                              STAGE: VOTE
    // =========================================================================
    describe("Stage: Vote", function () {
        it("Reverts if an unregistered user tries to vote", async function () {
            const encryptedVote = await encryptProposalId(Proposal.ProposalA, signers.voter3, contractAddress);
            await expect(
                contract.connect(signers.voter3).vote(encryptedVote.handles[0], encryptedVote.inputProof),
            ).to.be.revertedWith("Not registered");
        });

        it("Reverts if a voter tries to vote in the Registration stage", async function () {
            await contract.connect(signers.voter1).register({ value: REGISTRATION_FEE });
            const encryptedVote = await encryptProposalId(Proposal.ProposalA, signers.voter1, contractAddress);

            await expect(
                contract.connect(signers.voter1).vote(encryptedVote.handles[0], encryptedVote.inputProof),
            ).to.be.revertedWith("Not in vote stage");
        });

        it("Reverts if a voter tries to vote in the Done stage", async function () {
            await contract.connect(signers.voter1).register({ value: REGISTRATION_FEE });
            await contract.connect(signers.owner).advanceStage(); // Stage.Vote
            await contract.connect(signers.owner).advanceStage(); // Stage.Done
            const encryptedVote = await encryptProposalId(Proposal.ProposalB, signers.voter1, contractAddress);

            await expect(
                contract.connect(signers.voter1).vote(encryptedVote.handles[0], encryptedVote.inputProof),
            ).to.be.revertedWith("Not in vote stage");
        });

        it("Contract owwner tries to vote", async function () {
            await contract.connect(signers.owner).advanceStage();   
            const encryptedVote = await encryptProposalId(0, signers.owner, contractAddress);

            await expect(
                contract.connect(signers.owner).vote(encryptedVote.handles[0], encryptedVote.inputProof),
            ).to.be.revertedWith("Contract owner cannot perform this action");
        });
    });

    // =========================================================================
    //                           STAGE: DONE & WINNER
    // =========================================================================
    describe("Stage: Done & Winner", function () {
        it("Reverts if a non-owner tries to compute the winner", async function () {
            await expect(contract.connect(signers.voter1).revealEncryptedWinner()).to.be.revertedWith(
            "Not contract owner",
            );
        });

        it("Reverts if owner tries to compute winner before Stage.Done", async function () {
            await contract.connect(signers.owner).advanceStage(); // Stage.Vote

            await expect(contract.connect(signers.owner).revealEncryptedWinner()).to.be.revertedWith("Not in done stage");
        });

        it("Reverts if total proposals is zero when computing winner", async function () {
            const factory = (await ethers.getContractFactory(
                "FHEConfidentialVote",
            )) as FHEConfidentialVote__factory;
            const contractWithZeroProposals = (await factory.deploy(0)) as FHEConfidentialVote;
            await contractWithZeroProposals.connect(signers.owner).advanceStage(); // Stage.Vote
            await contractWithZeroProposals.connect(signers.owner).advanceStage(); // Stage.Done
            await expect(
                contractWithZeroProposals.connect(signers.owner).revealEncryptedWinner(),
            ).to.be.revertedWith("No proposals");
        });

        it("Reverts if total votes is zero when computing winner", async function () {
            await contract.connect(signers.owner).advanceStage(); // Stage.Vote
            await contract.connect(signers.owner).advanceStage(); // Stage.Done
            await expect(contract.connect(signers.owner).revealEncryptedWinner()).to.be.revertedWith("No votes cast");
        });
    });

    // =========================================================================
    //                              ADVANCE STAGE
    // =========================================================================
    describe("Advance Stage", function () {
        it("Owner advances Done stage", async function () {
            expect(await contract.stage()).to.eq(Stage.Registration);
            await contract.connect(signers.owner).advanceStage();
            expect(await contract.stage()).to.eq(Stage.Vote);
            await contract.connect(signers.owner).advanceStage();
            expect(await contract.stage()).to.eq(Stage.Done);
            await expect(contract.connect(signers.owner).advanceStage())
                .to.be.revertedWith("Already in final stage");
        });

        it("Non-owner tries to advance stage", async function () {
            // Non-owner cannot advance stage
            await expect(contract.connect(signers.voter1).advanceStage()).to.be.revertedWith("Not contract owner");
        });
    });

    // =========================================================================
    //                              RESET CONTRACT
    // =========================================================================
    describe("Reset Contract", function () {
        it("Non-owner tries to reset the contract", async function () {
            // Non-owner cannot reset
            await expect(contract.connect(signers.voter1).reset(NUM_PROPOSALS)).to.be.revertedWith("Not contract owner");
        });
    });
});

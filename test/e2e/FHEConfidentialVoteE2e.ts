import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { FHEConfidentialVote } from "../../types";
import { expect } from "chai";
import {
  deployFixture,
  encryptProposalId,
  decryptEuint32,
  Signers,
  Proposal,
  Stage,
  REGISTRATION_FEE,
} from "../helpers/FHEConfidentialVoteHelper";

describe("FHEConfidentialVote E2E Tests", function () {
  let signers: Signers;
  let contract: FHEConfidentialVote;
  let contractAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    // Assume first signer is the deployer/owner
    signers = { owner: ethSigners[0], voter1: ethSigners[1], voter2: ethSigners[2], voter3: ethSigners[3] };
  });

  beforeEach(async function () {
    // Skip if not running in a proper FHEVM environment
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }
    ({ contract, contractAddress } = await deployFixture());
  });

  // =========================================================================
  //                       HAPPY PATH
  // =========================================================================

  describe("Happy Path", function () {
    it("Complete happy path: registration -> voting -> reveal winner -> withdraw funds -> reset", async function () {
      // Registration
      expect(await contract.stage()).to.eq(Stage.Registration);
      await contract.connect(signers.voter1).register({ value: REGISTRATION_FEE });
      await contract.connect(signers.voter2).register({ value: REGISTRATION_FEE });
      await contract.connect(signers.voter3).register({ value: REGISTRATION_FEE });

      await contract.connect(signers.owner).advanceStage();

      // Voting
      expect(await contract.votersCount()).to.eq(3);
      expect(await contract.stage()).to.eq(Stage.Vote);

      const encryptedVote1 = await encryptProposalId(Proposal.ProposalA, signers.voter1, contractAddress);
      const encryptedVote2 = await encryptProposalId(Proposal.ProposalB, signers.voter2, contractAddress);
      const encryptedVote3 = await encryptProposalId(Proposal.ProposalB, signers.voter3, contractAddress);

      await contract.connect(signers.voter1).vote(encryptedVote1.handles[0], encryptedVote1.inputProof);
      await contract.connect(signers.voter2).vote(encryptedVote2.handles[0], encryptedVote2.inputProof);
      await contract.connect(signers.voter3).vote(encryptedVote3.handles[0], encryptedVote3.inputProof);

      expect(await contract.totalVotes()).to.eq(3n);

      await contract.connect(signers.owner).advanceStage();
      expect(await contract.stage()).to.eq(Stage.Done);

      // Reveal Winner
      await contract.connect(signers.owner).revealEncryptedWinner();
      const encryptedWinner = await contract.encryptedWinnerId();
      const winnerId = await decryptEuint32(encryptedWinner, signers.owner, contractAddress);

      expect(winnerId).to.eq(Proposal.ProposalB);

      // Withdraw Funds
      const contractBalanceBefore = await ethers.provider.getBalance(contractAddress);
      expect(contractBalanceBefore).to.eq(REGISTRATION_FEE * 3n);
      const ownerBalanceBefore = await ethers.provider.getBalance(signers.owner.address);

      const tx = await contract.connect(signers.owner).withdraw();
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const ownerBalanceAfter = await ethers.provider.getBalance(signers.owner.address);

      expect(await ethers.provider.getBalance(contractAddress)).to.eq(0);
      expect(ownerBalanceAfter).to.eq(ownerBalanceBefore + contractBalanceBefore - gasUsed);

      // Reset Contract
      await contract.connect(signers.owner).reset(4);
      expect(await contract.stage()).to.eq(Stage.Registration);
      expect(await contract.votersCount()).to.eq(0);
      expect(await contract.totalVotes()).to.eq(0);
    });
  });

  // =========================================================================
  //                    TOTAL PARTICIPATION SCENARIOS
  // =========================================================================

  describe("Scenarios based on participation", function () {
    beforeEach(async function () {
      await contract.connect(signers.voter1).register({ value: REGISTRATION_FEE });
      await contract.connect(signers.voter2).register({ value: REGISTRATION_FEE });
      await contract.connect(signers.voter3).register({ value: REGISTRATION_FEE });

      await contract.connect(signers.owner).advanceStage();
    });

    it("No votes scenario: winner computation fails gracefully", async function () {
      await contract.connect(signers.owner).advanceStage();

      await expect(contract.connect(signers.owner).revealEncryptedWinner()).to.be.revertedWith("No votes cast");
    });

    it("Single voter scenario: voter votes and winning proposal is computed correctly", async function () {
      const encryptedVote = await encryptProposalId(Proposal.ProposalB, signers.voter1, contractAddress);
      await contract.connect(signers.voter1).vote(encryptedVote.handles[0], encryptedVote.inputProof);

      await contract.connect(signers.owner).advanceStage();
      await contract.connect(signers.owner).revealEncryptedWinner();
      const encryptedWinner = await contract.encryptedWinnerId();
      const winnerId = await decryptEuint32(encryptedWinner, signers.owner, contractAddress);

      expect(winnerId).to.eq(Proposal.ProposalB);

      // Remaining votes check
      const encryptedRemainingVotes = await contract.getEncryptedRemainingVotes(signers.voter1.address);
      const remainingVotes = await decryptEuint32(encryptedRemainingVotes, signers.owner, contractAddress);
      expect(remainingVotes).to.eq(0);
    });

    it("Multiple voters scenario: voting process and winner proposal computation are as expected", async function () {
      const VOTES = [Proposal.ProposalA, Proposal.ProposalB, Proposal.ProposalB];

      const votersArray = [signers.voter1, signers.voter2, signers.voter3];
      for (let i = 0; i < VOTES.length; i++) {
        const encryptedVote = await encryptProposalId(VOTES[i], votersArray[i], contractAddress);
        await contract.connect(votersArray[i]).vote(encryptedVote.handles[0], encryptedVote.inputProof);
      }

      await contract.connect(signers.owner).advanceStage();
      await contract.connect(signers.owner).revealEncryptedWinner();
      const encryptedWinner = await contract.encryptedWinnerId();
      const winnerId = await decryptEuint32(encryptedWinner, signers.owner, contractAddress);

      expect(winnerId).to.eq(Proposal.ProposalB);

      for (let voter of votersArray) {
        const encryptedRemainingVotes = await contract.getEncryptedRemainingVotes(voter.address);
        const remainingVotes = await decryptEuint32(encryptedRemainingVotes, signers.owner, contractAddress);
        expect(remainingVotes).to.eq(0);
      }
    });
  });

  // =========================================================================
  //                            STAGE: REGISTRATION
  // =========================================================================

  describe("Stage: Registration", function () {
    it("Voter registration completes successfully and state is updated", async function () {
      await contract.connect(signers.voter1).register({ value: REGISTRATION_FEE });
      expect(await contract.votersCount()).to.eq(1);
      expect(await ethers.provider.getBalance(contractAddress)).to.eq(REGISTRATION_FEE);

      const encryptedRemainingVotes = await contract.getEncryptedRemainingVotes(signers.voter1.address);
      const clearRemainingVotes = await decryptEuint32(encryptedRemainingVotes, signers.owner, contractAddress);
      expect(clearRemainingVotes).to.eq(1);
    });
  });

  // =========================================================================
  //                              STAGE: VOTE
  // =========================================================================

  describe("Stage: Vote", function () {
    beforeEach(async function () {
      await contract.connect(signers.voter1).register({ value: REGISTRATION_FEE });
      await contract.connect(signers.voter2).register({ value: REGISTRATION_FEE });
      await contract.connect(signers.owner).advanceStage();
    });

    it("A voter can cast a valid encrypted vote and state is updated", async function () {
      const totalVotesBefore = await contract.totalVotes();

      const encryptedVote = await encryptProposalId(Proposal.ProposalC, signers.voter1, contractAddress);
      await contract.connect(signers.voter1).vote(encryptedVote.handles[0], encryptedVote.inputProof);

      expect(await contract.totalVotes()).to.eq(totalVotesBefore + 1n);

      const encryptedRemainingVotes = await contract.getEncryptedRemainingVotes(signers.voter1.address);
      const clearRemainingVotes = await decryptEuint32(encryptedRemainingVotes, signers.owner, contractAddress);
      expect(clearRemainingVotes).to.eq(0);
    });
  });

  // =========================================================================
  //                           STAGE: DONE & WINNER
  // =========================================================================

  describe("Stage: Done and Winner Calculation", function () {
    beforeEach(async function () {
      await contract.connect(signers.voter1).register({ value: REGISTRATION_FEE });
      await contract.connect(signers.voter2).register({ value: REGISTRATION_FEE });
      await contract.connect(signers.voter3).register({ value: REGISTRATION_FEE });
      await contract.connect(signers.owner).advanceStage();

      // Voter 1 votes for ProposalA
      let encryptedVote = await encryptProposalId(Proposal.ProposalA, signers.voter1, contractAddress);
      await contract.connect(signers.voter1).vote(encryptedVote.handles[0], encryptedVote.inputProof);
      // Voter 2 votes for ProposalA
      encryptedVote = await encryptProposalId(Proposal.ProposalA, signers.voter2, contractAddress);
      await contract.connect(signers.voter2).vote(encryptedVote.handles[0], encryptedVote.inputProof);
      // Voter 3 votes for ProposalB
      encryptedVote = await encryptProposalId(Proposal.ProposalB, signers.voter3, contractAddress);
      await contract.connect(signers.voter3).vote(encryptedVote.handles[0], encryptedVote.inputProof);

      await contract.connect(signers.owner).advanceStage();
    });

    it("Owner computes and decrypts the final encrypted winner ID", async function () {
      expect(await contract.stage()).to.eq(Stage.Done);
      expect(await contract.totalVotes()).to.eq(3n);

      await contract.connect(signers.owner).revealEncryptedWinner();

      const encryptedWinnerId = await contract.encryptedWinnerId();
      const clearWinnerId = await decryptEuint32(encryptedWinnerId, signers.owner, contractAddress);
      expect(clearWinnerId).to.eq(Proposal.ProposalA);
    });
  });

  // =========================================================================
  //                              RESET CONTRACT
  // =========================================================================

  describe("Reset the voting process", function () {
    it("Owner can reset the election to start a new round", async function () {
      await contract.connect(signers.voter1).register({ value: REGISTRATION_FEE });
      await contract.connect(signers.voter2).register({ value: REGISTRATION_FEE });
      await contract.connect(signers.owner).advanceStage();

      const encryptedVote = await encryptProposalId(0, signers.voter1, contractAddress);
      await contract.connect(signers.voter1).vote(encryptedVote.handles[0], encryptedVote.inputProof);
      await contract.connect(signers.owner).advanceStage();

      const newNumProposals = 4;
      await contract.connect(signers.owner).reset(newNumProposals);

      expect(await contract.stage()).to.eq(Stage.Registration);
      expect(await contract.totalVotes()).to.eq(0);
      expect(await contract.votersCount()).to.eq(0);
    });
  });

  // =========================================================================
  //                             WITHDRAWAL FUNDS
  // =========================================================================
  describe("Withdrawal contract funds", function () {
    it("Owner can withdraw collected funds", async function () {
      await contract.connect(signers.voter1).register({ value: REGISTRATION_FEE });
      await contract.connect(signers.voter2).register({ value: REGISTRATION_FEE });
      const expectedBalance = REGISTRATION_FEE * 2n;

      expect(await ethers.provider.getBalance(contractAddress)).to.eq(expectedBalance);

      const ownerBalanceBefore = await ethers.provider.getBalance(signers.owner.address);
      const tx = await contract.connect(signers.owner).withdraw();
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const ownerBalanceAfter = await ethers.provider.getBalance(signers.owner.address);

      expect(await ethers.provider.getBalance(contractAddress)).to.eq(0);
      expect(ownerBalanceAfter).to.eq(ownerBalanceBefore + expectedBalance - gasUsed);
    });
  });
});

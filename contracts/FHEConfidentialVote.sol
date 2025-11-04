// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint32, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {ebool} from "encrypted-types/EncryptedTypes.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title Confidential FHE voting contract
/// @notice Participants submit encrypted votes; tallies remain encrypted; winner revealed off-chain
contract FHEConfidentialVote is SepoliaConfig {
    struct Voter {
        uint voterId;
        address addr;
        euint32 remainingVotes;
    }

    struct Proposal {
        euint32 propId;
        euint32 count;
    }

    mapping(address => Voter) private voterDetails;
    Voter[] private voters;
    Proposal[] public proposals;
    euint32 public encryptedWinnerId;
    address public contractOwner;
    uint public votersCount;
    uint32 public totalVotes;

    enum Stage {
        Registration,
        Vote,
        Done
    }
    Stage public stage;

    event VoterRegistered(address voter);
    event WinnerEncrypted(euint32 encryptedWinner);

    constructor(uint32 numProposals) {
        contractOwner = msg.sender;

        for (uint i = 0; i < numProposals; i++) {
            euint32 initialCount = FHE.asEuint32(uint32(0));
            FHE.allowThis(initialCount);
            FHE.allow(initialCount, contractOwner);
            euint32 _propId = FHE.asEuint32(uint32(i));
            FHE.allowThis(_propId);
            FHE.allow(_propId, contractOwner);
            proposals.push(Proposal({propId: _propId, count: initialCount}));
        }

        stage = Stage.Registration;
        votersCount = 0;
        totalVotes = 0;
    }

    modifier onlyContractOwner() {
        require(msg.sender == contractOwner, "Not contract owner");
        _;
    }

    modifier onlyRegistered() {
        require(voterDetails[msg.sender].addr != address(0), "Not registered");
        _;
    }

    modifier onlyUnregistered() {
        require(voterDetails[msg.sender].addr == address(0), "Already registered");
        _;
    }

    modifier exceptContractOwner() {
        require(msg.sender != contractOwner, "Contract owner cannot perform this action");
        _;
    }

    modifier stageIsReg() {
        require(stage == Stage.Registration, "Not in registration stage");
        _;
    }

    modifier stageIsVote() {
        require(stage == Stage.Vote, "Not in vote stage");
        _;
    }

    modifier stageIsDone() {
        require(stage == Stage.Done, "Not in done stage");
        _;
    }

    modifier hasEnoughEther(uint256 amount) {
        require(msg.value >= amount, "Insufficient Ether sent");
        _;
    }

    /// @notice Register as a voter
    function register() public payable stageIsReg onlyUnregistered exceptContractOwner hasEnoughEther(0.005 ether) {
        uint256 requiredFee = 0.005 ether;
        if (msg.value > requiredFee) {
            payable(msg.sender).transfer(msg.value - requiredFee);
        }

        uint newVoterId = voters.length;
        euint32 encryptedOne = FHE.asEuint32(uint32(1));
        FHE.allowThis(encryptedOne);
        FHE.allow(encryptedOne, contractOwner);

        Voter memory newVoter = Voter({voterId: newVoterId, addr: msg.sender, remainingVotes: encryptedOne});
        FHE.allowThis(newVoter.remainingVotes);
        FHE.allow(newVoter.remainingVotes, contractOwner);

        voters.push(newVoter);
        voterDetails[msg.sender] = newVoter;
        votersCount++;

        emit VoterRegistered(msg.sender);
    }

    /// @notice Cast a vote using an encrypted proposal ID
    function vote(
        externalEuint32 encryptedPropId,
        bytes calldata propProof
    ) public exceptContractOwner onlyRegistered stageIsVote {
        Voter storage voter = voterDetails[msg.sender];
        euint32 one = FHE.asEuint32(uint32(1));
        euint32 zero = FHE.asEuint32(uint32(0));
        euint32 internalEncryptedPropId = FHE.fromExternal(encryptedPropId, propProof);

        for (uint i = 0; i < proposals.length; i++) {
            euint32 newPropCount = FHE.add(
                proposals[i].count,
                FHE.mul(FHE.asEuint32(FHE.eq(internalEncryptedPropId, proposals[i].propId)), one)
            );
            FHE.allowThis(newPropCount);
            FHE.allowTransient(newPropCount, contractOwner);

            ebool condition = FHE.gt(voter.remainingVotes, zero);
            FHE.allowThis(condition);
            FHE.allowTransient(condition, contractOwner);
            proposals[i].count = FHE.select(condition, newPropCount, proposals[i].count);
            FHE.allowThis(proposals[i].count);
            FHE.allowTransient(proposals[i].count, contractOwner);
        }

        ebool hasVotesLeft = FHE.gt(voter.remainingVotes, zero);
        FHE.allowThis(hasVotesLeft);
        FHE.allowTransient(hasVotesLeft, contractOwner);

        euint32 decrementedVotes = FHE.sub(voter.remainingVotes, one);
        FHE.allowThis(decrementedVotes);
        FHE.allowTransient(decrementedVotes, contractOwner);
        voter.remainingVotes = FHE.select(hasVotesLeft, decrementedVotes, voter.remainingVotes);
        voterDetails[msg.sender].remainingVotes = voter.remainingVotes;
        FHE.allowThis(voterDetails[msg.sender].remainingVotes);
        FHE.allow(voterDetails[msg.sender].remainingVotes, contractOwner);
        totalVotes++;
    }

    /// @notice Compute the encrypted winner and store it on-chain
    function revealEncryptedWinner() public onlyContractOwner stageIsDone {
        require(proposals.length > 0, "No proposals");
        require(totalVotes > 0, "No votes cast");

        euint32 maxCount = proposals[0].count;
        euint32 winnerId = proposals[0].propId;

        for (uint i = 1; i < proposals.length; i++) {
            euint32 proposalCount = proposals[i].count;
            ebool condition = FHE.gt(proposalCount, maxCount);
            FHE.allowThis(condition);
            FHE.allow(condition, contractOwner);

            maxCount = FHE.select(condition, proposalCount, maxCount);
            winnerId = FHE.select(condition, proposals[i].propId, winnerId);
        }

        encryptedWinnerId = winnerId;
        FHE.allowThis(encryptedWinnerId);
        FHE.allow(encryptedWinnerId, contractOwner);
        emit WinnerEncrypted(encryptedWinnerId);
    }

    function advanceStage() public onlyContractOwner {
        require(stage != Stage.Done, "Already in final stage");
        stage = Stage(uint(stage) + 1);
    }

    /// @notice Get encrypted proposal count
    function getEncryptedProposalCount(uint propId) public view returns (euint32) {
        require(propId < proposals.length, "Invalid proposal ID");
        return proposals[propId].count;
    }

    /// @notice Get encrypted remaining votes of a voter
    function getEncryptedRemainingVotes(address voter) public view returns (euint32) {
        require(voterDetails[voter].addr != address(0), "Not a voter");
        return voterDetails[voter].remainingVotes;
    }

    function isRemainingVotesZero(address voter) public returns (ebool) {
        require(voterDetails[voter].addr != address(0), "Not a voter");
        euint32 zero = FHE.asEuint32(uint32(0));
        ebool isZero = FHE.eq(voterDetails[voter].remainingVotes, zero);
        return isZero;
    }

    function withdraw() public onlyContractOwner {
        uint balance = address(this).balance;
        require(balance > 0, "No funds");
        payable(contractOwner).transfer(balance);
    }

    function reset(uint numProposals) public onlyContractOwner {
        delete proposals;
        for (uint i = 0; i < numProposals; i++) {
            euint32 initialCount = FHE.asEuint32(uint32(0));
            FHE.allowThis(initialCount);
            euint32 _propId = FHE.asEuint32(uint32(i));
            FHE.allowThis(_propId);
            proposals.push(Proposal({propId: _propId, count: initialCount}));
        }

        address[] memory voterAddresses = new address[](voters.length);
        for (uint i = 0; i < voters.length; i++) {
            voterAddresses[i] = voters[i].addr;
        }

        for (uint i = 0; i < voters.length; i++) {
            delete voterDetails[voters[i].addr];
        }
        delete voters;
        votersCount = 0;

        stage = Stage.Registration;
        totalVotes = 0;
    }
}

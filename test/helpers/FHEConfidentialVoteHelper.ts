import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { FHEConfidentialVote, FHEConfidentialVote__factory } from "../../types";
import { FhevmType } from "@fhevm/hardhat-plugin";

// -----------------------------
// Types
// -----------------------------
export type Signers = {
  owner: HardhatEthersSigner;
  voter1: HardhatEthersSigner;
  voter2: HardhatEthersSigner;
  voter3: HardhatEthersSigner;
};

// -----------------------------
// Constants
// -----------------------------
export const NUM_PROPOSALS = 3;
export const REGISTRATION_FEE = ethers.parseEther("0.005");
export const INSUFFICIENT_FEE = ethers.parseEther("0.001");

// -----------------------------
// Enums
// -----------------------------
export enum Proposal {
  ProposalA = 0,
  ProposalB = 1,
  ProposalC = 2,
}

export enum Stage {
  Registration = 0,
  Vote = 1,
  Done = 2,
}

// -----------------------------
// Deployment Fixture
// -----------------------------
export async function deployFixture() {
  const factory = (await ethers.getContractFactory("FHEConfidentialVote")) as FHEConfidentialVote__factory;
  const contract = (await factory.deploy(NUM_PROPOSALS)) as FHEConfidentialVote;
  const contractAddress = await contract.getAddress();

  return { contract, contractAddress };
}

// -----------------------------
// Proposal encryption and decryption helpers
// -----------------------------
export async function encryptProposalId(
  proposalId: number,
  voter: HardhatEthersSigner,
  contractAddress: string,
) {
  return fhevm.createEncryptedInput(contractAddress, voter.address).add32(proposalId).encrypt();
}

export async function decryptEuint32(
  encryptedValue: string,
  decryptingSigner: HardhatEthersSigner,
  contractAddress: string,
) {
  return fhevm.userDecryptEuint(FhevmType.euint32, encryptedValue, contractAddress, decryptingSigner);
}
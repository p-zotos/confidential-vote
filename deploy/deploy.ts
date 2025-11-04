import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const totalProposals = 3;

  const deployedFHEConfidentialVote = await deploy("FHEConfidentialVote", {
    from: deployer,
    log: true,
    args: [totalProposals],
  });

  console.log(`FHEConfidentialVote contract: `, deployedFHEConfidentialVote.address);
};
export default func;
func.id = "deploy_fhrConfidentialVote"; // id required to prevent reexecution
func.tags = ["FHEConfidentialVote"];

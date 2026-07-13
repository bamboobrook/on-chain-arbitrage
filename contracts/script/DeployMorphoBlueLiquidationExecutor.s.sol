// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {MorphoBlueLiquidationExecutor} from "../src/MorphoBlueLiquidationExecutor.sol";

/// @notice Deploys the wallet-funded Morpho Blue liquidation executor.
///         Run:
///         forge script script/DeployMorphoBlueLiquidationExecutor.s.sol \
///           --rpc-url $RPC_ETHEREUM_URL --broadcast --private-key $PRIVATE_KEY \
///           --tc DeployMorphoBlueLiquidationExecutorScript
///
///         Optional env:
///         - MORPHO_BLUE_EXECUTOR_ADMIN overrides vm.addr(PRIVATE_KEY).
contract DeployMorphoBlueLiquidationExecutorScript is Script {
    function run() public returns (MorphoBlueLiquidationExecutor executor) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.envOr("MORPHO_BLUE_EXECUTOR_ADMIN", vm.addr(privateKey));
        if (admin == address(0)) revert("MORPHO_BLUE_EXECUTOR_ADMIN cannot be zero");

        vm.startBroadcast(privateKey);
        executor = new MorphoBlueLiquidationExecutor(admin);
        vm.stopBroadcast();

        console2.log("MorphoBlueLiquidationExecutor: chainId", block.chainid);
        console2.log("MorphoBlueLiquidationExecutor: admin", admin);
        console2.log("MorphoBlueLiquidationExecutor: executor", address(executor));
    }
}

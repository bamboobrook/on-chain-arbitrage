// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {CompoundV3LiquidationExecutor} from "../src/CompoundV3LiquidationExecutor.sol";

/// @notice Deploys the wallet-funded Compound V3 liquidation executor.
///         Run:
///         forge script script/DeployCompoundV3LiquidationExecutor.s.sol \
///           --rpc-url $RPC_ETHEREUM_URL --broadcast --private-key $PRIVATE_KEY \
///           --tc DeployCompoundV3LiquidationExecutorScript
///
///         Optional env:
///         - COMPOUND_V3_EXECUTOR_ADMIN overrides vm.addr(PRIVATE_KEY).
contract DeployCompoundV3LiquidationExecutorScript is Script {
    function run() public returns (CompoundV3LiquidationExecutor executor) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.envOr("COMPOUND_V3_EXECUTOR_ADMIN", vm.addr(privateKey));
        if (admin == address(0)) revert("COMPOUND_V3_EXECUTOR_ADMIN cannot be zero");

        vm.startBroadcast(privateKey);
        executor = new CompoundV3LiquidationExecutor(admin);
        vm.stopBroadcast();

        console2.log("CompoundV3LiquidationExecutor: chainId", block.chainid);
        console2.log("CompoundV3LiquidationExecutor: admin", admin);
        console2.log("CompoundV3LiquidationExecutor: executor", address(executor));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {AaveV3LiquidationExecutor} from "../src/AaveV3LiquidationExecutor.sol";

/// @notice Deploys the Aave V3 flash-loan liquidation executor for one chain.
///         Run:
///         forge script script/DeployAaveV3LiquidationExecutor.s.sol \
///           --rpc-url $RPC_ETHEREUM_URL --broadcast --private-key $PRIVATE_KEY \
///           --tc DeployAaveV3LiquidationExecutorScript
///
///         Optional env:
///         - AAVE_POOL overrides the known chain pool address.
///         - AAVE_EXECUTOR_ADMIN overrides vm.addr(PRIVATE_KEY).
contract DeployAaveV3LiquidationExecutorScript is Script {
    function run() public returns (address executor) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.envOr("AAVE_EXECUTOR_ADMIN", vm.addr(privateKey));
        address pool = vm.envOr("AAVE_POOL", defaultAavePool());
        if (pool == address(0)) {
            revert("AAVE_POOL is required for this chain");
        }
        if (admin == address(0)) {
            revert("AAVE_EXECUTOR_ADMIN cannot be zero");
        }

        vm.startBroadcast(privateKey);
        executor = address(new AaveV3LiquidationExecutor(pool, admin));
        vm.stopBroadcast();

        console2.log("AaveV3LiquidationExecutor: chainId", block.chainid);
        console2.log("AaveV3LiquidationExecutor: pool", pool);
        console2.log("AaveV3LiquidationExecutor: admin", admin);
        console2.log("AaveV3LiquidationExecutor: executor", executor);
    }

    function defaultAavePool() internal view returns (address) {
        if (block.chainid == 1) return 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;
        if (block.chainid == 8453) return 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5;
        if (block.chainid == 42161) return 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
        if (block.chainid == 137) return 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
        return address(0);
    }
}

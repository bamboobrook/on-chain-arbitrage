// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {DeployScript, Deployments, MockAsset} from "./Deploy.s.sol";
import {StrategyController} from "../src/StrategyController.sol";

/// @notice One-shot local Anvil deployment for demos: deploy + seed demo funds
///         + deposit + register a default atomic-amm allocation, all in a
///         single broadcast so the broadcaster is admin throughout.
///         Run:
///         forge script script/LocalAnvil.s.sol --rpc-url http://127.0.0.1:8545 \
///           --broadcast --private-key $PRIVATE_KEY --tc LocalAnvilScript
contract LocalAnvilScript is DeployScript {
    function run() public override returns (Deployments memory d) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);

        d = _deployCore(); // deploys + wires (msg.sender == broadcaster)

        // Seed demo funds and give the vault an initial TVL.
        MockAsset(d.asset).mint(msg.sender, 1_000_000e18);
        MockAsset(d.asset).approve(address(d.vault), type(uint256).max);
        d.vault.deposit(10_000e18, msg.sender);

        // Register the atomic-amm strategy allocation.
        bytes32 stratId = keccak256("atomic-amm");
        StrategyController.Allocation memory alloc = StrategyController.Allocation({
            maxCapital: 100_000e18,
            maxLossPerDay: 1_000e18,
            maxDeployablePct: 8_000, // 80%
            active: true
        });
        d.controller.setAllocation(address(d.vault), stratId, alloc);

        vm.stopBroadcast();

        _log(d);
        console2.log("LocalAnvil: seeded vault TVL 10000 + registered atomic-amm");
    }
}

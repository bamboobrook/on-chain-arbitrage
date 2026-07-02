// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ArbVault} from "../src/ArbVault.sol";
import {StrategyExecutor} from "../src/StrategyExecutor.sol";
import {StrategyController} from "../src/StrategyController.sol";
import {RiskManager} from "../src/RiskManager.sol";
import {Accounting} from "../src/Accounting.sol";
import {ArbTimelockController} from "../src/ArbTimelockController.sol";

struct Deployments {
    address asset;
    ArbVault vault;
    StrategyExecutor executor;
    StrategyController controller;
    RiskManager risk;
    Accounting accounting;
    ArbTimelockController timelock;
}

/// @notice Demo asset used when no real ASSET is provided.
contract MockAsset is ERC20 {
    constructor(string memory name, string memory sym) ERC20(name, sym) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

/// @notice Deploys the full system and wires trust relationships. All logic
///         lives in one Script contract so that under `vm.startBroadcast(pk)`
///         every `new` and external call has msg.sender = broadcaster.
///         Run: forge script script/Deploy.s.sol --rpc-url $RPC --broadcast \
///              --private-key $PK --tc DeployScript
contract DeployScript is Script {
    /// @notice Entry point — wraps `_deployCore` in a broadcast.
    function run() public virtual returns (Deployments memory d) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(privateKey);
        d = _deployCore();
        vm.stopBroadcast();
        _log(d);
    }

    /// @dev Core deploy + wiring. Caller must already be in a broadcast so that
    ///      msg.sender (== broadcaster) is admin on every contract.
    function _deployCore() internal returns (Deployments memory d) {
        address broadcaster = msg.sender;
        address asset = vm.envOr("ASSET", address(0));
        uint256 perfFeeBps = uint256(vm.envOr("PERF_FEE_BPS", uint256(1000)));
        address feeRecipient = vm.envOr("FEE_RECIPIENT", broadcaster);

        d.accounting = new Accounting();
        d.risk = new RiskManager(broadcaster);
        d.controller = new StrategyController(broadcaster);

        address[] memory proposers = new address[](1);
        proposers[0] = broadcaster;
        address[] memory executors = new address[](1);
        executors[0] = broadcaster;
        d.timelock = new ArbTimelockController(2 days, proposers, executors, broadcaster);

        d.asset = asset == address(0) ? address(new MockAsset("Demo USDC", "dUSDC")) : asset;

        d.vault = new ArbVault(
            IERC20(d.asset),
            "ArbVault USDC",
            "arbUSDC",
            perfFeeBps,
            feeRecipient,
            broadcaster,
            d.risk,
            d.accounting
        );

        d.executor = new StrategyExecutor(broadcaster, d.controller, d.risk, d.accounting);

        // Wiring — all under the same broadcast, msg.sender == broadcaster.
        d.executor.setTrustedVault(address(d.vault), true);
        d.vault.grantRole(d.vault.EXECUTOR_ROLE(), address(d.executor));
        d.risk.setAllowedChain(block.chainid, true);
    }

    function _log(Deployments memory d) internal view {
        console2.log("Deploy: asset     ", d.asset);
        console2.log("Deploy: vault     ", address(d.vault));
        console2.log("Deploy: executor  ", address(d.executor));
        console2.log("Deploy: controller", address(d.controller));
        console2.log("Deploy: risk      ", address(d.risk));
        console2.log("Deploy: accounting", address(d.accounting));
        console2.log("Deploy: timelock  ", address(d.timelock));
    }
}

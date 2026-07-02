// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ArbVault} from "../src/ArbVault.sol";
import {StrategyExecutor} from "../src/StrategyExecutor.sol";
import {StrategyController} from "../src/StrategyController.sol";
import {RiskManager} from "../src/RiskManager.sol";
import {Accounting} from "../src/Accounting.sol";
import {IDexAdapter} from "../src/interfaces/IDexAdapter.sol";

/// @notice Mock asset (reused).
contract MockAsset is ERC20 {
    constructor(string memory name, string memory sym) ERC20(name, sym) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

/// @notice Mock DEX adapter that simulates a profitable swap. It pulls the
///         input token from the caller, burns it, and mints input + surplus to
///         the recipient. Models a real venue (input consumed, output minted).
contract ProfitableAdapter is IDexAdapter {
    MockAsset public asset;
    uint256 public profitBps; // surplus returned over input

    constructor(MockAsset asset_, uint256 profitBps_) {
        asset = asset_;
        profitBps = profitBps_;
    }

    function swap(address, address tokenIn, address, uint256 amountIn, uint256, address recipient)
        external
        returns (uint256 amountOut)
    {
        require(tokenIn == address(asset), "ProfitableAdapter: asset only");
        asset.transferFrom(msg.sender, address(this), amountIn);
        asset.burn(address(this), amountIn); // consume input
        amountOut = amountIn + (amountIn * profitBps) / 10_000;
        asset.mint(recipient, amountOut);
    }
}

/// @notice Mock adapter that simulates a loss.
contract LosingAdapter is IDexAdapter {
    MockAsset public asset;
    uint256 public lossBps;

    constructor(MockAsset asset_, uint256 lossBps_) {
        asset = asset_;
        lossBps = lossBps_;
    }

    function swap(address, address tokenIn, address, uint256 amountIn, uint256, address recipient)
        external
        returns (uint256 amountOut)
    {
        require(tokenIn == address(asset), "LosingAdapter: asset only");
        asset.transferFrom(msg.sender, address(this), amountIn);
        asset.burn(address(this), amountIn);
        amountOut = amountIn - (amountIn * lossBps) / 10_000;
        asset.mint(recipient, amountOut);
    }
}

contract StrategyExecutorTest is Test {
    MockAsset asset;
    ArbVault vault;
    StrategyExecutor executor;
    StrategyController controller;
    RiskManager rm;
    Accounting accounting;
    ProfitableAdapter adapter;
    bytes32 strategyId = keccak256("atomic-amm");
    address admin = address(this);

    function setUp() public {
        asset = new MockAsset("USDC", "USDC");
        accounting = new Accounting();
        rm = new RiskManager(admin);
        controller = new StrategyController(admin);
        vault = new ArbVault(IERC20(asset), "Arb USDC", "arbUSDC", 0, admin, admin, rm, accounting);

        executor = new StrategyExecutor(admin, controller, rm, accounting);

        // Wire up trust.
        executor.setTrustedVault(address(vault), true);
        vault.grantRole(vault.EXECUTOR_ROLE(), address(executor));

        // Allow chain & strategy allocation.
        rm.setAllowedChain(block.chainid, true);
        StrategyController.Allocation memory alloc = StrategyController.Allocation({
            maxCapital: type(uint256).max,
            maxLossPerDay: type(uint256).max,
            maxDeployablePct: 10_000,
            active: true
        });
        controller.setExecutor(address(executor), true);
        controller.setAllocation(address(vault), strategyId, alloc);

        // Create the profitable adapter and whitelist it.
        adapter = new ProfitableAdapter(asset, 100); // +1% per hop
        executor.whitelistAdapter(address(adapter), true);
    }

    function _fundVaultAndExecutor(uint256 principal) internal {
        asset.mint(address(vault), principal);
        // The executor pulls principal itself; we pre-fund it for the test.
        asset.mint(address(executor), principal);
        asset.mint(address(executor), 0); // touch
        vm.prank(address(executor));
        asset.approve(address(vault), type(uint256).max);
    }

    function testExecuteProfitableRoute() public {
        uint256 principal = 100e18;
        _fundVaultAndExecutor(principal);

        // Single-hop route: asset -> asset via profitable adapter (+1%).
        StrategyExecutor.Hop[] memory route = new StrategyExecutor.Hop[](1);
        route[0] = StrategyExecutor.Hop({
            adapter: address(adapter),
            pool: address(0xBEEF),
            tokenIn: address(asset),
            tokenOut: address(asset),
            minAmountOut: 0
        });

        StrategyExecutor.ExecutionRequest memory req = StrategyExecutor.ExecutionRequest({
            vault: vault,
            asset: IERC20(asset),
            strategyId: strategyId,
            principal: principal,
            route: route,
            minProfitAssets: 0, // accept any profit
            deadline: block.timestamp + 600
        });

        uint256 profit = executor.execute(req);
        // +1% on 100 = 1e18 profit.
        assertEq(profit, 1e18);
        assertEq(vault.totalRealizedProfit(), 1e18);
    }

    function testExecuteRevertsOnInsufficientProfitFloor() public {
        uint256 principal = 100e18;
        _fundVaultAndExecutor(principal);

        StrategyExecutor.Hop[] memory route = new StrategyExecutor.Hop[](1);
        route[0] = StrategyExecutor.Hop({
            adapter: address(adapter),
            pool: address(0xBEEF),
            tokenIn: address(asset),
            tokenOut: address(asset),
            minAmountOut: 0
        });

        StrategyExecutor.ExecutionRequest memory req = StrategyExecutor.ExecutionRequest({
            vault: vault,
            asset: IERC20(asset),
            strategyId: strategyId,
            principal: principal,
            route: route,
            minProfitAssets: 5e18, // demand 5, only 1 available
            deadline: block.timestamp + 600
        });

        vm.expectRevert();
        executor.execute(req);
    }

    function testUntrustedVaultReverts() public {
        executor.setTrustedVault(address(vault), false);
        _fundVaultAndExecutor(100e18);
        StrategyExecutor.Hop[] memory route = new StrategyExecutor.Hop[](1);
        route[0] = StrategyExecutor.Hop({
            adapter: address(adapter),
            pool: address(0),
            tokenIn: address(asset),
            tokenOut: address(asset),
            minAmountOut: 0
        });
        StrategyExecutor.ExecutionRequest memory req = StrategyExecutor.ExecutionRequest({
            vault: vault,
            asset: IERC20(asset),
            strategyId: strategyId,
            principal: 100e18,
            route: route,
            minProfitAssets: 0,
            deadline: block.timestamp + 600
        });
        vm.expectRevert(abi.encodeWithSelector(StrategyExecutor.UntrustedVault.selector));
        executor.execute(req);
    }

    function testNonWhitelistedAdapterReverts() public {
        ProfitableAdapter bad = new ProfitableAdapter(asset, 100);
        executor.whitelistAdapter(address(bad), false);

        _fundVaultAndExecutor(100e18);
        StrategyExecutor.Hop[] memory route = new StrategyExecutor.Hop[](1);
        route[0] = StrategyExecutor.Hop({
            adapter: address(bad),
            pool: address(0),
            tokenIn: address(asset),
            tokenOut: address(asset),
            minAmountOut: 0
        });
        StrategyExecutor.ExecutionRequest memory req = StrategyExecutor.ExecutionRequest({
            vault: vault,
            asset: IERC20(asset),
            strategyId: strategyId,
            principal: 100e18,
            route: route,
            minProfitAssets: 0,
            deadline: block.timestamp + 600
        });
        vm.expectRevert();
        executor.execute(req);
    }
}

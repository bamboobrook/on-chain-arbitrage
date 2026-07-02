// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ArbVault} from "../src/ArbVault.sol";
import {RiskManager} from "../src/RiskManager.sol";
import {Accounting} from "../src/Accounting.sol";

/// @notice Simple 18-dec ERC20 used as the vault asset in tests.
contract MockAsset is ERC20 {
    constructor(string memory name, string memory sym) ERC20(name, sym) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

contract ArbVaultTest is Test {
    MockAsset asset;
    ArbVault vault;
    address admin = address(this);
    address feeRecipient = address(0xFEE);
    address alice = address(0xA11CE);
    address executor = address(0xE7EC);

    function setUp() public {
        asset = new MockAsset("USDC", "USDC");
        Accounting accounting = new Accounting();
        RiskManager rm = new RiskManager(admin);
        vault =
            new ArbVault(IERC20(asset), "Arb USDC", "arbUSDC", 1000, feeRecipient, admin, rm, accounting);
        asset.mint(alice, 1_000e18);
        vm.prank(alice);
        asset.approve(address(vault), type(uint256).max);
    }

    function testDepositMintsShares() public {
        vm.prank(alice);
        uint256 shares = vault.deposit(100e18, alice);
        // 1:1 on first deposit (no prior profit)
        assertEq(shares, 100e18);
        assertEq(vault.balanceOf(alice), 100e18);
        assertEq(vault.totalAssets(), 100e18);
    }

    function testRedeemReturnsAssets() public {
        vm.startPrank(alice);
        vault.deposit(100e18, alice);
        uint256 balBefore = asset.balanceOf(alice);
        vault.redeem(50e18, alice, alice);
        assertEq(asset.balanceOf(alice) - balBefore, 50e18);
        assertEq(vault.balanceOf(alice), 50e18);
        vm.stopPrank();
    }

    function testProfitReportAccruesToSharePrice() public {
        vm.prank(alice);
        vault.deposit(100e18, alice);

        // Grant executor role and fund vault with extra "profit".
        vault.grantRole(vault.EXECUTOR_ROLE(), executor);
        asset.mint(address(vault), 10e18);

        vm.prank(executor);
        vault.reportProfit(10e18, 0);

        // totalRealizedProfit tracks, and feeRecipient got perf-fee shares.
        assertEq(vault.totalRealizedProfit(), 10e18);
        assertTrue(vault.balanceOf(feeRecipient) > 0);
    }

    function testProfitReportRevertsOnInsufficientProfit() public {
        vm.prank(alice);
        vault.deposit(100e18, alice);
        vault.grantRole(vault.EXECUTOR_ROLE(), executor);
        asset.mint(address(vault), 5e18);

        vm.expectRevert();
        vm.prank(executor);
        vault.reportProfit(5e18, 6e18); // 5 < 6 floor
    }

    function testPauseBlocksDeposit() public {
        vault.pause();
        vm.startPrank(alice);
        vm.expectRevert();
        vault.deposit(1e18, alice);
        vm.stopPrank();
    }

    function testNonExecutorCannotReportProfit() public {
        vm.prank(alice);
        vault.deposit(100e18, alice);
        asset.mint(address(vault), 1e18);
        vm.expectRevert();
        vault.reportProfit(1e18, 0);
    }

    function testSetPerformanceFeeCapsAt50pct() public {
        vault.setPerformanceFee(5000); // 50% ok
        assertEq(vault.performanceFeeBps(), 5000);
        vm.expectRevert();
        vault.setPerformanceFee(5001); // > 50% reverts
    }
}

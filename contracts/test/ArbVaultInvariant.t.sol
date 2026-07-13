// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArbVault} from "../src/ArbVault.sol";
import {RiskManager} from "../src/RiskManager.sol";
import {Accounting} from "../src/Accounting.sol";

contract MockAsset is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
    function burn(address from, uint256 amt) external { _burn(from, amt); }
}

/// @title ArbVault Invariant Tests (Phase 6)
/// @notice Per plan §6: principal immutability, unauthorized execution prevention.
contract ArbVaultInvariantTest is Test {
    MockAsset asset;
    ArbVault vault;
    RiskManager rm;
    Accounting accounting;
    address admin = address(this);

    function setUp() public {
        asset = new MockAsset("USDC", "USDC");
        accounting = new Accounting();
        rm = new RiskManager(admin);
        vault = new ArbVault(IERC20(asset), "Arb", "ARB", 1000, admin, admin, rm, accounting);
        asset.mint(address(this), 1_000_000e18);
        asset.approve(address(vault), type(uint256).max);
    }

    function testInvariant_PrincipalPreserved() public {
        vault.deposit(100e18, address(this));
        vault.deposit(50e18, address(0xBEEF));
        assertGe(vault.totalAssets(), 150e18 - 1, "assets below deposits");
        vault.redeem(30e18, address(this), address(this));
        assertGe(vault.totalAssets(), 120e18 - 1, "assets below expected after redeem");
    }

    function testInvariant_NonExecutorCannotReport() public {
        vault.deposit(100e18, address(this));
        asset.mint(address(vault), 10e18);
        vm.prank(address(0x1234));
        vm.expectRevert();
        vault.reportProfit(10e18, 0);
    }

    function testInvariant_PauseBlocksDeposit() public {
        vault.pause();
        vm.expectRevert();
        vault.deposit(1e18, address(this));
    }

    function testInvariant_FeeCapped() public {
        vm.expectRevert();
        vault.setPerformanceFee(5001);
        vault.setPerformanceFee(5000);
        assertEq(vault.performanceFeeBps(), 5000);
    }
}

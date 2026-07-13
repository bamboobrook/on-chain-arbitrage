// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {CompoundV3LiquidationExecutor, ICometLike} from "../src/CompoundV3LiquidationExecutor.sol";
import {IDexAdapter} from "../src/interfaces/IDexAdapter.sol";

contract CompoundMockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

contract MockComet is ICometLike {
    CompoundMockToken public immutable base;
    CompoundMockToken public immutable collateral;
    bool public liquidatable;
    uint256 public collateralOut;
    address public lastAbsorber;
    address public lastBorrower;

    constructor(CompoundMockToken base_, CompoundMockToken collateral_) {
        base = base_;
        collateral = collateral_;
    }

    function setLiquidatable(bool value) external {
        liquidatable = value;
    }

    function setCollateralOut(uint256 value) external {
        collateralOut = value;
    }

    function isLiquidatable(address) external view returns (bool) {
        return liquidatable;
    }

    function absorb(address absorber, address[] calldata accounts) external {
        require(liquidatable, "comet: not liquidatable");
        require(accounts.length == 1, "comet: accounts");
        lastAbsorber = absorber;
        lastBorrower = accounts[0];
    }

    function buyCollateral(address asset, uint256 minAmount, uint256 baseAmount, address recipient) external {
        require(asset == address(collateral), "comet: collateral");
        require(collateralOut >= minAmount, "comet: min collateral");
        require(base.transferFrom(msg.sender, address(this), baseAmount), "comet: base transfer");
        collateral.mint(recipient, collateralOut);
    }
}

contract CompoundMockAdapter is IDexAdapter {
    CompoundMockToken public immutable tokenInExpected;
    CompoundMockToken public immutable tokenOutMinted;
    uint256 public immutable outBps;

    constructor(CompoundMockToken tokenInExpected_, CompoundMockToken tokenOutMinted_, uint256 outBps_) {
        tokenInExpected = tokenInExpected_;
        tokenOutMinted = tokenOutMinted_;
        outBps = outBps_;
    }

    function swap(address, address tokenIn, address, uint256 amountIn, uint256 minAmountOut, address recipient)
        external
        returns (uint256 amountOut)
    {
        require(tokenIn == address(tokenInExpected), "adapter: tokenIn");
        require(tokenInExpected.transferFrom(msg.sender, address(this), amountIn), "adapter: transferFrom");
        tokenInExpected.burn(address(this), amountIn);
        amountOut = (amountIn * outBps) / 10_000;
        require(amountOut >= minAmountOut, "adapter: slippage");
        tokenOutMinted.mint(recipient, amountOut);
    }
}

contract CompoundV3LiquidationExecutorTest is Test {
    CompoundMockToken base;
    CompoundMockToken collateral;
    MockComet comet;
    CompoundV3LiquidationExecutor executor;
    CompoundMockAdapter profitableAdapter;
    CompoundMockAdapter losingAdapter;

    address user = address(0xA11CE);
    address borrower = address(0xB0B);
    address beneficiary = address(0xBEEF);

    function setUp() public {
        base = new CompoundMockToken("USD Coin", "USDC");
        collateral = new CompoundMockToken("Wrapped Ether", "WETH");
        comet = new MockComet(base, collateral);
        executor = new CompoundV3LiquidationExecutor(address(this));
        profitableAdapter = new CompoundMockAdapter(collateral, base, 11_000);
        losingAdapter = new CompoundMockAdapter(collateral, base, 9_000);
        executor.whitelistAdapter(address(profitableAdapter), true);
        base.mint(user, 1_000 ether);
        comet.setLiquidatable(true);
        comet.setCollateralOut(100 ether);
    }

    function _route(address adapter, uint256 minOut)
        internal
        view
        returns (CompoundV3LiquidationExecutor.Hop[] memory route)
    {
        route = new CompoundV3LiquidationExecutor.Hop[](1);
        route[0] = CompoundV3LiquidationExecutor.Hop({
            adapter: adapter,
            pool: address(0xCAFE),
            tokenIn: address(collateral),
            tokenOut: address(base),
            minAmountOut: minOut
        });
    }

    function _request(address adapter, uint256 minProfit)
        internal
        view
        returns (CompoundV3LiquidationExecutor.ExecutionRequest memory req)
    {
        req = CompoundV3LiquidationExecutor.ExecutionRequest({
            comet: comet,
            baseAsset: base,
            borrower: borrower,
            collateralAsset: address(collateral),
            baseAmount: 100 ether,
            minCollateralAmount: 100 ether,
            unwindRoute: _route(adapter, 110 ether),
            minProfitBase: minProfit,
            deadline: block.timestamp + 600,
            beneficiary: beneficiary
        });
    }

    function testExecuteProfitableCompoundLiquidationPaysBeneficiary() public {
        vm.prank(user);
        base.approve(address(executor), 100 ether);

        vm.prank(user);
        uint256 profit = executor.execute(_request(address(profitableAdapter), 10 ether));

        assertEq(profit, 10 ether);
        assertEq(base.balanceOf(user), 900 ether);
        assertEq(base.balanceOf(beneficiary), 110 ether);
        assertEq(base.balanceOf(address(executor)), 0);
        assertEq(collateral.balanceOf(address(executor)), 0);
        assertEq(comet.lastAbsorber(), address(executor));
        assertEq(comet.lastBorrower(), borrower);
    }

    function testRevertsBeforePullingFundsWhenAccountIsNotLiquidatable() public {
        comet.setLiquidatable(false);
        vm.prank(user);
        base.approve(address(executor), 100 ether);

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(CompoundV3LiquidationExecutor.AccountNotLiquidatable.selector, borrower)
        );
        executor.execute(_request(address(profitableAdapter), 0));

        assertEq(base.balanceOf(user), 1_000 ether);
    }

    function testRevertsAtomicallyWhenProfitFloorIsNotMet() public {
        executor.whitelistAdapter(address(losingAdapter), true);
        vm.prank(user);
        base.approve(address(executor), 100 ether);

        vm.prank(user);
        vm.expectRevert();
        executor.execute(_request(address(losingAdapter), 1 ether));

        assertEq(base.balanceOf(user), 1_000 ether);
        assertEq(base.balanceOf(beneficiary), 0);
        assertEq(base.balanceOf(address(executor)), 0);
    }

    function testRevertsForUnwhitelistedAdapter() public {
        vm.prank(user);
        base.approve(address(executor), 100 ether);

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(
                CompoundV3LiquidationExecutor.AdapterNotWhitelisted.selector,
                address(losingAdapter)
            )
        );
        executor.execute(_request(address(losingAdapter), 0));
    }

    function testRevertsWhenRouteDoesNotCloseToBase() public {
        CompoundV3LiquidationExecutor.Hop[] memory route = new CompoundV3LiquidationExecutor.Hop[](1);
        route[0] = CompoundV3LiquidationExecutor.Hop({
            adapter: address(profitableAdapter),
            pool: address(0xCAFE),
            tokenIn: address(collateral),
            tokenOut: address(collateral),
            minAmountOut: 1
        });
        CompoundV3LiquidationExecutor.ExecutionRequest memory req = CompoundV3LiquidationExecutor.ExecutionRequest({
            comet: comet,
            baseAsset: base,
            borrower: borrower,
            collateralAsset: address(collateral),
            baseAmount: 100 ether,
            minCollateralAmount: 100 ether,
            unwindRoute: route,
            minProfitBase: 0,
            deadline: block.timestamp + 600,
            beneficiary: beneficiary
        });

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(
                CompoundV3LiquidationExecutor.RouteDoesNotCloseToBase.selector,
                address(collateral),
                address(base)
            )
        );
        executor.execute(req);
    }
}

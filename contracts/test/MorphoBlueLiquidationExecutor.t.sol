// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {MorphoBlueLiquidationExecutor, IMorphoBlueLike} from "../src/MorphoBlueLiquidationExecutor.sol";
import {IDexAdapter} from "../src/interfaces/IDexAdapter.sol";

contract MorphoMockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

contract MockMorphoBlue is IMorphoBlueLike {
    MorphoMockToken public immutable loan;
    MorphoMockToken public immutable collateralToken;
    uint256 public supplyShares;
    uint256 public borrowShares;
    uint256 public collateral;
    uint256 public assetsSeizedOut;
    uint256 public assetsRepaidOut;
    bool public liquidatable = true;
    address public lastBorrower;
    uint256 public lastRepaidShares;

    constructor(MorphoMockToken loan_, MorphoMockToken collateralToken_) {
        loan = loan_;
        collateralToken = collateralToken_;
    }

    function setPosition(uint256 supplyShares_, uint256 borrowShares_, uint256 collateral_) external {
        supplyShares = supplyShares_;
        borrowShares = borrowShares_;
        collateral = collateral_;
    }

    function setLiquidation(uint256 assetsSeized_, uint256 assetsRepaid_) external {
        assetsSeizedOut = assetsSeized_;
        assetsRepaidOut = assetsRepaid_;
    }

    function setLiquidatable(bool value) external {
        liquidatable = value;
    }

    function position(bytes32, address) external view returns (uint256, uint256, uint256) {
        return (supplyShares, borrowShares, collateral);
    }

    function liquidate(
        MarketParams calldata marketParams,
        address borrower,
        uint256 seizedAssets,
        uint256 repaidShares,
        bytes calldata
    ) external returns (uint256 assetsSeized, uint256 assetsRepaid) {
        require(liquidatable, "morpho: not liquidatable");
        require(marketParams.loanToken == address(loan), "morpho: loan");
        require(marketParams.collateralToken == address(collateralToken), "morpho: collateral");
        require(seizedAssets == 0 || repaidShares == 0, "morpho: mode");
        if (seizedAssets > 0) {
            require(seizedAssets <= collateral, "morpho: seized");
        } else {
            require(repaidShares > 0 && repaidShares <= borrowShares, "morpho: shares");
        }
        require(loan.transferFrom(msg.sender, address(this), assetsRepaidOut), "morpho: transfer");
        collateralToken.mint(msg.sender, assetsSeizedOut);
        borrowShares = repaidShares > 0 && borrowShares > repaidShares ? borrowShares - repaidShares : 0;
        collateral = collateral > assetsSeizedOut ? collateral - assetsSeizedOut : 0;
        lastBorrower = borrower;
        lastRepaidShares = repaidShares;
        return (assetsSeizedOut, assetsRepaidOut);
    }
}

contract MorphoMockAdapter is IDexAdapter {
    MorphoMockToken public immutable tokenInExpected;
    MorphoMockToken public immutable tokenOutMinted;
    uint256 public immutable outBps;

    constructor(MorphoMockToken tokenInExpected_, MorphoMockToken tokenOutMinted_, uint256 outBps_) {
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

contract MorphoBlueLiquidationExecutorTest is Test {
    MorphoMockToken loan;
    MorphoMockToken collateral;
    MockMorphoBlue morpho;
    MorphoBlueLiquidationExecutor executor;
    MorphoMockAdapter profitableAdapter;
    MorphoMockAdapter losingAdapter;

    address user = address(0xA11CE);
    address borrower = address(0xB0B);

    function setUp() public {
        loan = new MorphoMockToken("USD Coin", "USDC");
        collateral = new MorphoMockToken("Wrapped Ether", "WETH");
        morpho = new MockMorphoBlue(loan, collateral);
        executor = new MorphoBlueLiquidationExecutor(address(this));
        profitableAdapter = new MorphoMockAdapter(collateral, loan, 11_000);
        losingAdapter = new MorphoMockAdapter(collateral, loan, 9_000);
        executor.whitelistAdapter(address(profitableAdapter), true);
        loan.mint(user, 1_000 ether);
        morpho.setPosition(0, 100 ether, 100 ether);
        morpho.setLiquidation(100 ether, 100 ether);
    }

    function _marketParams() internal view returns (IMorphoBlueLike.MarketParams memory params) {
        params = IMorphoBlueLike.MarketParams({
            loanToken: address(loan),
            collateralToken: address(collateral),
            oracle: address(0x0A0C1E),
            irm: address(0x1AA1),
            lltv: 0.86 ether
        });
    }

    function _route(address adapter, uint256 minOut)
        internal
        view
        returns (MorphoBlueLiquidationExecutor.Hop[] memory route)
    {
        route = new MorphoBlueLiquidationExecutor.Hop[](1);
        route[0] = MorphoBlueLiquidationExecutor.Hop({
            adapter: adapter,
            pool: address(0xCAFE),
            tokenIn: address(collateral),
            tokenOut: address(loan),
            minAmountOut: minOut
        });
    }

    function _request(address adapter, uint256 minProfit)
        internal
        view
        returns (MorphoBlueLiquidationExecutor.ExecutionRequest memory req)
    {
        req = MorphoBlueLiquidationExecutor.ExecutionRequest({
            morpho: morpho,
            marketParams: _marketParams(),
            borrower: borrower,
            seizedAssets: 0,
            repaidShares: 100 ether,
            maxRepayAssets: 100 ether,
            minCollateralSeized: 100 ether,
            unwindRoute: _route(adapter, 110 ether),
            minProfitLoan: minProfit,
            deadline: block.timestamp + 600,
            beneficiary: user
        });
    }

    function testExecuteProfitableMorphoLiquidationPaysUser() public {
        vm.prank(user);
        loan.approve(address(executor), 100 ether);

        vm.prank(user);
        uint256 profit = executor.execute(_request(address(profitableAdapter), 10 ether));

        assertEq(profit, 10 ether);
        assertEq(loan.balanceOf(user), 1_010 ether);
        assertEq(loan.balanceOf(address(executor)), 0);
        assertEq(collateral.balanceOf(address(executor)), 0);
        assertEq(morpho.lastBorrower(), borrower);
        assertEq(morpho.lastRepaidShares(), 100 ether);
    }

    function testExecuteProfitableMorphoLiquidationWithSeizedAssetsMode() public {
        MorphoBlueLiquidationExecutor.ExecutionRequest memory req =
            _request(address(profitableAdapter), 10 ether);
        req.seizedAssets = 100 ether;
        req.repaidShares = 0;

        vm.prank(user);
        loan.approve(address(executor), 100 ether);

        vm.prank(user);
        uint256 profit = executor.execute(req);

        assertEq(profit, 10 ether);
        assertEq(loan.balanceOf(user), 1_010 ether);
        assertEq(morpho.lastBorrower(), borrower);
        assertEq(morpho.lastRepaidShares(), 0);
    }

    function testRevertsBeforePullingFundsWhenPositionHasNoBorrow() public {
        morpho.setPosition(0, 0, 100 ether);
        vm.prank(user);
        loan.approve(address(executor), 100 ether);

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(MorphoBlueLiquidationExecutor.PositionNotBorrowing.selector, borrower)
        );
        executor.execute(_request(address(profitableAdapter), 0));

        assertEq(loan.balanceOf(user), 1_000 ether);
    }

    function testRevertsAtomicallyWhenMorphoLiquidateReverts() public {
        morpho.setLiquidatable(false);
        vm.prank(user);
        loan.approve(address(executor), 100 ether);

        vm.prank(user);
        vm.expectRevert();
        executor.execute(_request(address(profitableAdapter), 0));

        assertEq(loan.balanceOf(user), 1_000 ether);
        assertEq(loan.balanceOf(address(executor)), 0);
    }

    function testRevertsAtomicallyWhenProfitFloorIsNotMet() public {
        executor.whitelistAdapter(address(losingAdapter), true);
        vm.prank(user);
        loan.approve(address(executor), 100 ether);

        vm.prank(user);
        vm.expectRevert();
        executor.execute(_request(address(losingAdapter), 1 ether));

        assertEq(loan.balanceOf(user), 1_000 ether);
        assertEq(loan.balanceOf(address(executor)), 0);
    }

    function testRevertsForUnwhitelistedAdapter() public {
        vm.prank(user);
        loan.approve(address(executor), 100 ether);

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(
                MorphoBlueLiquidationExecutor.AdapterNotWhitelisted.selector,
                address(losingAdapter)
            )
        );
        executor.execute(_request(address(losingAdapter), 0));
    }

    function testRevertsWhenRouteDoesNotCloseToLoan() public {
        MorphoBlueLiquidationExecutor.Hop[] memory route = new MorphoBlueLiquidationExecutor.Hop[](1);
        route[0] = MorphoBlueLiquidationExecutor.Hop({
            adapter: address(profitableAdapter),
            pool: address(0xCAFE),
            tokenIn: address(collateral),
            tokenOut: address(collateral),
            minAmountOut: 1
        });
        MorphoBlueLiquidationExecutor.ExecutionRequest memory req = MorphoBlueLiquidationExecutor.ExecutionRequest({
            morpho: morpho,
            marketParams: _marketParams(),
            borrower: borrower,
            seizedAssets: 0,
            repaidShares: 100 ether,
            maxRepayAssets: 100 ether,
            minCollateralSeized: 100 ether,
            unwindRoute: route,
            minProfitLoan: 0,
            deadline: block.timestamp + 600,
            beneficiary: user
        });

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(
                MorphoBlueLiquidationExecutor.RouteDoesNotCloseToLoan.selector,
                address(collateral),
                address(loan)
            )
        );
        executor.execute(req);
    }
}

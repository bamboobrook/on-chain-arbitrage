// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {WalletAtomicArbitrageExecutor} from "../src/WalletAtomicArbitrageExecutor.sol";
import {IDexAdapter} from "../src/interfaces/IDexAdapter.sol";

contract WalletArbMockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

contract WalletArbMockAdapter is IDexAdapter {
    WalletArbMockToken public immutable tokenInExpected;
    WalletArbMockToken public immutable tokenOutMinted;
    uint256 public immutable outBps;

    constructor(WalletArbMockToken tokenInExpected_, WalletArbMockToken tokenOutMinted_, uint256 outBps_) {
        tokenInExpected = tokenInExpected_;
        tokenOutMinted = tokenOutMinted_;
        outBps = outBps_;
    }

    function swap(address, address tokenIn, address, uint256 amountIn, uint256 minAmountOut, address recipient)
        external
        returns (uint256 amountOut)
    {
        require(tokenIn == address(tokenInExpected), "mock: tokenIn");
        require(tokenInExpected.transferFrom(msg.sender, address(this), amountIn), "mock: transferFrom");
        tokenInExpected.burn(address(this), amountIn);
        amountOut = (amountIn * outBps) / 10_000;
        require(amountOut >= minAmountOut, "mock: slippage");
        tokenOutMinted.mint(recipient, amountOut);
    }
}

contract WalletAtomicArbitrageExecutorTest is Test {
    WalletArbMockToken asset;
    WalletArbMockToken mid;
    WalletAtomicArbitrageExecutor executor;
    WalletArbMockAdapter profitable;
    WalletArbMockAdapter losing;
    WalletArbMockAdapter toMid;
    WalletArbMockAdapter toAsset;
    address user = address(0xA11CE);
    address beneficiary = address(0xB0B);

    function setUp() public {
        asset = new WalletArbMockToken("USD Coin", "USDC");
        mid = new WalletArbMockToken("Wrapped Ether", "WETH");
        executor = new WalletAtomicArbitrageExecutor(address(this));
        profitable = new WalletArbMockAdapter(asset, asset, 10_100);
        losing = new WalletArbMockAdapter(asset, asset, 9_900);
        toMid = new WalletArbMockAdapter(asset, mid, 10_000);
        toAsset = new WalletArbMockAdapter(mid, asset, 10_100);
        executor.whitelistAdapter(address(profitable), true);
        executor.whitelistAdapter(address(toMid), true);
        executor.whitelistAdapter(address(toAsset), true);
        asset.mint(user, 1_000 ether);
    }

    function _approveUser(uint256 amount) internal {
        vm.prank(user);
        asset.approve(address(executor), amount);
    }

    function testExecuteProfitableWalletRoutePaysBeneficiary() public {
        uint256 amountIn = 100 ether;
        _approveUser(amountIn);

        WalletAtomicArbitrageExecutor.Hop[] memory route = new WalletAtomicArbitrageExecutor.Hop[](1);
        route[0] = WalletAtomicArbitrageExecutor.Hop({
            adapter: address(profitable),
            pool: address(0xBEEF),
            tokenIn: address(asset),
            tokenOut: address(asset),
            minAmountOut: 101 ether
        });
        WalletAtomicArbitrageExecutor.ExecutionRequest memory req = WalletAtomicArbitrageExecutor.ExecutionRequest({
            asset: asset,
            amountIn: amountIn,
            route: route,
            minProfitAssets: 1 ether,
            deadline: block.timestamp + 600,
            beneficiary: beneficiary
        });

        vm.prank(user);
        uint256 profit = executor.execute(req);

        assertEq(profit, 1 ether);
        assertEq(asset.balanceOf(user), 900 ether);
        assertEq(asset.balanceOf(beneficiary), 101 ether);
        assertEq(asset.balanceOf(address(executor)), 0);
    }

    function testExecuteMultiHopWalletRoute() public {
        uint256 amountIn = 100 ether;
        _approveUser(amountIn);

        WalletAtomicArbitrageExecutor.Hop[] memory route = new WalletAtomicArbitrageExecutor.Hop[](2);
        route[0] = WalletAtomicArbitrageExecutor.Hop({
            adapter: address(toMid),
            pool: address(0xCAFE),
            tokenIn: address(asset),
            tokenOut: address(mid),
            minAmountOut: 100 ether
        });
        route[1] = WalletAtomicArbitrageExecutor.Hop({
            adapter: address(toAsset),
            pool: address(0xBEEF),
            tokenIn: address(mid),
            tokenOut: address(asset),
            minAmountOut: 101 ether
        });
        WalletAtomicArbitrageExecutor.ExecutionRequest memory req = WalletAtomicArbitrageExecutor.ExecutionRequest({
            asset: asset,
            amountIn: amountIn,
            route: route,
            minProfitAssets: 1 ether,
            deadline: block.timestamp + 600,
            beneficiary: address(0)
        });

        vm.prank(user);
        uint256 profit = executor.execute(req);

        assertEq(profit, 1 ether);
        assertEq(asset.balanceOf(user), 1_001 ether);
        assertEq(asset.balanceOf(address(executor)), 0);
        assertEq(mid.balanceOf(address(executor)), 0);
    }

    function testRevertsWhenProfitFloorIsNotMet() public {
        uint256 amountIn = 100 ether;
        _approveUser(amountIn);
        executor.whitelistAdapter(address(losing), true);

        WalletAtomicArbitrageExecutor.Hop[] memory route = new WalletAtomicArbitrageExecutor.Hop[](1);
        route[0] = WalletAtomicArbitrageExecutor.Hop({
            adapter: address(losing),
            pool: address(0xBEEF),
            tokenIn: address(asset),
            tokenOut: address(asset),
            minAmountOut: 0
        });
        WalletAtomicArbitrageExecutor.ExecutionRequest memory req = WalletAtomicArbitrageExecutor.ExecutionRequest({
            asset: asset,
            amountIn: amountIn,
            route: route,
            minProfitAssets: 1,
            deadline: block.timestamp + 600,
            beneficiary: beneficiary
        });

        vm.prank(user);
        vm.expectRevert();
        executor.execute(req);

        assertEq(asset.balanceOf(user), 1_000 ether);
        assertEq(asset.balanceOf(beneficiary), 0);
    }

    function testRevertsForNonWhitelistedAdapter() public {
        uint256 amountIn = 100 ether;
        _approveUser(amountIn);

        WalletAtomicArbitrageExecutor.Hop[] memory route = new WalletAtomicArbitrageExecutor.Hop[](1);
        route[0] = WalletAtomicArbitrageExecutor.Hop({
            adapter: address(losing),
            pool: address(0xBEEF),
            tokenIn: address(asset),
            tokenOut: address(asset),
            minAmountOut: 0
        });
        WalletAtomicArbitrageExecutor.ExecutionRequest memory req = WalletAtomicArbitrageExecutor.ExecutionRequest({
            asset: asset,
            amountIn: amountIn,
            route: route,
            minProfitAssets: 0,
            deadline: block.timestamp + 600,
            beneficiary: beneficiary
        });

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(WalletAtomicArbitrageExecutor.AdapterNotWhitelisted.selector, address(losing)));
        executor.execute(req);
    }

    function testRevertsWhenRouteDoesNotClose() public {
        uint256 amountIn = 100 ether;
        _approveUser(amountIn);

        WalletAtomicArbitrageExecutor.Hop[] memory route = new WalletAtomicArbitrageExecutor.Hop[](1);
        route[0] = WalletAtomicArbitrageExecutor.Hop({
            adapter: address(toMid),
            pool: address(0xCAFE),
            tokenIn: address(asset),
            tokenOut: address(mid),
            minAmountOut: 0
        });
        WalletAtomicArbitrageExecutor.ExecutionRequest memory req = WalletAtomicArbitrageExecutor.ExecutionRequest({
            asset: asset,
            amountIn: amountIn,
            route: route,
            minProfitAssets: 0,
            deadline: block.timestamp + 600,
            beneficiary: beneficiary
        });

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(
                WalletAtomicArbitrageExecutor.RouteDoesNotClose.selector,
                address(mid),
                address(asset)
            )
        );
        executor.execute(req);
    }

    function testRevertsWhenHopTokenContinuityBreaks() public {
        uint256 amountIn = 100 ether;
        _approveUser(amountIn);

        WalletAtomicArbitrageExecutor.Hop[] memory route = new WalletAtomicArbitrageExecutor.Hop[](2);
        route[0] = WalletAtomicArbitrageExecutor.Hop({
            adapter: address(toMid),
            pool: address(0xCAFE),
            tokenIn: address(asset),
            tokenOut: address(mid),
            minAmountOut: 0
        });
        route[1] = WalletAtomicArbitrageExecutor.Hop({
            adapter: address(profitable),
            pool: address(0xBEEF),
            tokenIn: address(asset),
            tokenOut: address(asset),
            minAmountOut: 0
        });
        WalletAtomicArbitrageExecutor.ExecutionRequest memory req = WalletAtomicArbitrageExecutor.ExecutionRequest({
            asset: asset,
            amountIn: amountIn,
            route: route,
            minProfitAssets: 0,
            deadline: block.timestamp + 600,
            beneficiary: beneficiary
        });

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(
                WalletAtomicArbitrageExecutor.RouteTokenMismatch.selector,
                1,
                address(mid),
                address(asset)
            )
        );
        executor.execute(req);
    }
}

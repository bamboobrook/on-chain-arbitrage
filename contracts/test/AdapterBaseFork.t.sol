// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BalancerV2VaultAdapter} from "../src/adapters/BalancerV2VaultAdapter.sol";
import {CurveStableSwapAdapter} from "../src/adapters/CurveStableSwapAdapter.sol";
import {UniswapV2Adapter} from "../src/adapters/UniswapV2Adapter.sol";
import {UniswapV3Adapter} from "../src/adapters/UniversalDexAdapter.sol";

contract AdapterBaseForkTest is Test {
    address constant ETHEREUM_DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
    address constant ETHEREUM_USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant ETHEREUM_WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant ETHEREUM_BAL = 0xba100000625a3754423978a60c9317c58a424e3D;
    address constant ETHEREUM_CURVE_3POOL = 0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7;
    address constant ETHEREUM_BALANCER_VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
    address constant ETHEREUM_BALANCER_BAL_WETH_8020 = 0x5c6Ee304399DBdB9C8Ef030aB642B10820DB8F56;

    address constant BASE_WETH = 0x4200000000000000000000000000000000000006;
    address constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant BASE_UNISWAP_V3_WETH_USDC_005 = 0xd0b53D9277642d899DF5C87A3966A349A798F224;

    address constant POLYGON_USDC = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174;
    address constant POLYGON_WETH = 0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619;
    address constant POLYGON_QUICKSWAP_V2_USDC_WETH = 0x853Ee4b2A13f8a742d64C8F088bE7bA2131f670d;

    address constant ARBITRUM_USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    address constant ARBITRUM_WETH = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;
    address constant ARBITRUM_SUSHI_V2_USDC_WETH = 0x57b85FEf094e10b5eeCDF350Af688299E9553378;
    address constant ARBITRUM_UNISWAP_V3_USDC_WETH_005 = 0xC6962004f452bE9203591991D15f6b388e09E8D0;

    function _shouldRunForkTests() internal view returns (bool) {
        string memory runForkTests = vm.envOr("RUN_FORK_TESTS", string(""));
        return keccak256(bytes(runForkTests)) == keccak256(bytes("1"));
    }

    function _createForkIfConfigured(string memory envVar) internal returns (bool) {
        if (!_shouldRunForkTests()) return false;
        string memory rpc = vm.envOr(envVar, string(""));
        if (bytes(rpc).length == 0) return false;
        vm.createSelectFork(rpc);
        return true;
    }

    function testBaseForkV3AdapterSwapsWethToUsdc() public {
        if (!_createForkIfConfigured("RPC_BASE_URL")) return;

        address trader = address(0xA11CE);
        address recipient = address(0xB0B);
        uint256 amountIn = 0.001 ether;
        UniswapV3Adapter adapter = new UniswapV3Adapter();

        deal(BASE_WETH, trader, amountIn);
        vm.startPrank(trader);
        IERC20(BASE_WETH).approve(address(adapter), amountIn);
        uint256 amountOut = adapter.swap(
            BASE_UNISWAP_V3_WETH_USDC_005,
            BASE_WETH,
            BASE_USDC,
            amountIn,
            1,
            recipient
        );
        vm.stopPrank();

        assertGt(amountOut, 1);
        assertEq(IERC20(BASE_USDC).balanceOf(recipient), amountOut);
    }

    function testEthereumForkCurveAdapterSwapsDaiToUsdcOn3Pool() public {
        if (!_createForkIfConfigured("RPC_ETHEREUM_URL")) return;

        address trader = address(0xA11CE);
        address recipient = address(0xB0B);
        uint256 amountIn = 10 ether;
        CurveStableSwapAdapter adapter = new CurveStableSwapAdapter();

        deal(ETHEREUM_DAI, trader, amountIn);
        vm.startPrank(trader);
        IERC20(ETHEREUM_DAI).approve(address(adapter), amountIn);
        uint256 amountOut = adapter.swap(
            ETHEREUM_CURVE_3POOL,
            ETHEREUM_DAI,
            ETHEREUM_USDC,
            amountIn,
            1,
            recipient
        );
        vm.stopPrank();

        assertGt(amountOut, 1);
        assertEq(IERC20(ETHEREUM_USDC).balanceOf(recipient), amountOut);
    }

    function testEthereumForkBalancerAdapterSwapsWethToBal() public {
        if (!_createForkIfConfigured("RPC_ETHEREUM_URL")) return;

        address trader = address(0xA11CE);
        address recipient = address(0xB0B);
        uint256 amountIn = 0.001 ether;
        BalancerV2VaultAdapter adapter = new BalancerV2VaultAdapter(ETHEREUM_BALANCER_VAULT);

        deal(ETHEREUM_WETH, trader, amountIn);
        vm.startPrank(trader);
        IERC20(ETHEREUM_WETH).approve(address(adapter), amountIn);
        uint256 amountOut = adapter.swap(
            ETHEREUM_BALANCER_BAL_WETH_8020,
            ETHEREUM_WETH,
            ETHEREUM_BAL,
            amountIn,
            1,
            recipient
        );
        vm.stopPrank();

        assertGt(amountOut, 1);
        assertEq(IERC20(ETHEREUM_BAL).balanceOf(recipient), amountOut);
    }

    function testPolygonForkV2AdapterSwapsUsdcToWethOnQuickSwap() public {
        if (!_createForkIfConfigured("RPC_POLYGON_URL")) return;

        address trader = address(0xA11CE);
        address recipient = address(0xB0B);
        uint256 amountIn = 10e6;
        UniswapV2Adapter adapter = new UniswapV2Adapter();

        deal(POLYGON_USDC, trader, amountIn);
        vm.startPrank(trader);
        IERC20(POLYGON_USDC).approve(address(adapter), amountIn);
        uint256 amountOut = adapter.swap(
            POLYGON_QUICKSWAP_V2_USDC_WETH,
            POLYGON_USDC,
            POLYGON_WETH,
            amountIn,
            1,
            recipient
        );
        vm.stopPrank();

        assertGt(amountOut, 1);
        assertEq(IERC20(POLYGON_WETH).balanceOf(recipient), amountOut);
    }

    function testArbitrumForkV2AdapterSwapsUsdcToWethOnSushi() public {
        if (!_createForkIfConfigured("RPC_ARBITRUM_URL")) return;

        address trader = address(0xA11CE);
        address recipient = address(0xB0B);
        uint256 amountIn = 10e6;
        UniswapV2Adapter adapter = new UniswapV2Adapter();

        deal(ARBITRUM_USDC, trader, amountIn);
        vm.startPrank(trader);
        IERC20(ARBITRUM_USDC).approve(address(adapter), amountIn);
        uint256 amountOut = adapter.swap(
            ARBITRUM_SUSHI_V2_USDC_WETH,
            ARBITRUM_USDC,
            ARBITRUM_WETH,
            amountIn,
            1,
            recipient
        );
        vm.stopPrank();

        assertGt(amountOut, 1);
        assertEq(IERC20(ARBITRUM_WETH).balanceOf(recipient), amountOut);
    }

    function testArbitrumForkV3AdapterSwapsUsdcToWethOnUniswap() public {
        if (!_createForkIfConfigured("RPC_ARBITRUM_URL")) return;

        address trader = address(0xA11CE);
        address recipient = address(0xB0B);
        uint256 amountIn = 10e6;
        UniswapV3Adapter adapter = new UniswapV3Adapter();

        deal(ARBITRUM_USDC, trader, amountIn);
        vm.startPrank(trader);
        IERC20(ARBITRUM_USDC).approve(address(adapter), amountIn);
        uint256 amountOut = adapter.swap(
            ARBITRUM_UNISWAP_V3_USDC_WETH_005,
            ARBITRUM_USDC,
            ARBITRUM_WETH,
            amountIn,
            1,
            recipient
        );
        vm.stopPrank();

        assertGt(amountOut, 1);
        assertEq(IERC20(ARBITRUM_WETH).balanceOf(recipient), amountOut);
    }
}

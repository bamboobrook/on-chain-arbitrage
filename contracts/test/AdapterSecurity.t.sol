// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {
    BalancerV2VaultAdapter,
    IBalancerV2Vault
} from "../src/adapters/BalancerV2VaultAdapter.sol";
import {CurveStableSwapAdapter} from "../src/adapters/CurveStableSwapAdapter.sol";
import {UniswapV2Adapter} from "../src/adapters/UniswapV2Adapter.sol";
import {UniswapV3Adapter} from "../src/adapters/UniversalDexAdapter.sol";

contract AdapterMockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockV2Pair {
    using SafeERC20 for IERC20;

    address public token0;
    address public token1;
    uint112 private reserve0;
    uint112 private reserve1;

    constructor(address token0_, address token1_, uint112 reserve0_, uint112 reserve1_) {
        token0 = token0_;
        token1 = token1_;
        reserve0 = reserve0_;
        reserve1 = reserve1_;
        AdapterMockToken(token0_).mint(address(this), reserve0_);
        AdapterMockToken(token1_).mint(address(this), reserve1_);
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, 0);
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata) external {
        if (amount0Out > 0) IERC20(token0).safeTransfer(to, amount0Out);
        if (amount1Out > 0) IERC20(token1).safeTransfer(to, amount1Out);
    }
}

interface IUniswapV3SwapCallback {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data)
        external;
}

contract MockV3Pool {
    using SafeERC20 for IERC20;

    address public token0;
    address public token1;
    uint256 public amountOut;
    bool public mismatchCallbackAmount;

    constructor(address token0_, address token1_, uint256 amountOut_) {
        token0 = token0_;
        token1 = token1_;
        amountOut = amountOut_;
        AdapterMockToken(token0_).mint(address(this), 1_000_000 ether);
        AdapterMockToken(token1_).mint(address(this), 1_000_000 ether);
    }

    function setMismatchCallbackAmount(bool mismatch) external {
        mismatchCallbackAmount = mismatch;
    }

    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1) {
        uint256 amountIn = uint256(amountSpecified);
        uint256 callbackAmount = mismatchCallbackAmount ? amountIn - 1 : amountIn;
        if (zeroForOne) {
            IUniswapV3SwapCallback(msg.sender).uniswapV3SwapCallback(
                int256(callbackAmount), -int256(amountOut), data
            );
            IERC20(token1).safeTransfer(recipient, amountOut);
            return (int256(callbackAmount), -int256(amountOut));
        }
        IUniswapV3SwapCallback(msg.sender).uniswapV3SwapCallback(
            -int256(amountOut), int256(callbackAmount), data
        );
        IERC20(token0).safeTransfer(recipient, amountOut);
        return (-int256(amountOut), int256(callbackAmount));
    }
}

contract MockCurvePool {
    using SafeERC20 for IERC20;

    address[2] public coins;
    uint256 public rate;

    constructor(address token0_, address token1_, uint256 rate_) {
        coins[0] = token0_;
        coins[1] = token1_;
        rate = rate_;
        AdapterMockToken(token0_).mint(address(this), 1_000_000 ether);
        AdapterMockToken(token1_).mint(address(this), 1_000_000 ether);
    }

    function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256) {
        require(i >= 0 && i < 2 && j >= 0 && j < 2, "bad index");
        return (dx * rate) / 1e18;
    }

    function exchange(int128 i, int128 j, uint256 dx, uint256 minDy) external returns (uint256 dy) {
        require(i >= 0 && i < 2 && j >= 0 && j < 2, "bad index");
        address tokenIn = coins[uint256(int256(i))];
        address tokenOut = coins[uint256(int256(j))];
        dy = (dx * rate) / 1e18;
        require(dy >= minDy, "slippage");
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), dx);
        IERC20(tokenOut).safeTransfer(msg.sender, dy);
    }
}

contract MockBalancerPool {
    bytes32 private immutable poolId_;

    constructor(bytes32 poolId__) {
        poolId_ = poolId__;
    }

    function getPoolId() external view returns (bytes32) {
        return poolId_;
    }
}

contract MockBalancerVault is IBalancerV2Vault {
    using SafeERC20 for IERC20;

    bytes32 public expectedPoolId;
    uint256 public rate = 9e17;

    constructor(bytes32 expectedPoolId_) {
        expectedPoolId = expectedPoolId_;
    }

    function swap(
        IBalancerV2Vault.SingleSwap calldata singleSwap,
        IBalancerV2Vault.FundManagement calldata funds,
        uint256 limit,
        uint256
    )
        external
        payable
        returns (uint256 amountCalculated)
    {
        require(singleSwap.poolId == expectedPoolId, "pool id");
        require(singleSwap.kind == IBalancerV2Vault.SwapKind.GIVEN_IN, "kind");
        require(!funds.fromInternalBalance && !funds.toInternalBalance, "internal balance");
        amountCalculated = (singleSwap.amount * rate) / 1e18;
        require(amountCalculated >= limit, "limit");
        IERC20(address(singleSwap.assetIn)).safeTransferFrom(funds.sender, address(this), singleSwap.amount);
        IERC20(address(singleSwap.assetOut)).safeTransfer(funds.recipient, amountCalculated);
    }
}

contract AdapterSecurityTest is Test {
    AdapterMockToken token0;
    AdapterMockToken token1;
    UniswapV2Adapter v2Adapter;
    UniswapV3Adapter v3Adapter;
    CurveStableSwapAdapter curveAdapter;
    address trader = address(0xA11CE);
    address recipient = address(0xB0B);

    function setUp() public {
        token0 = new AdapterMockToken("Token0", "TK0");
        token1 = new AdapterMockToken("Token1", "TK1");
        v2Adapter = new UniswapV2Adapter();
        v3Adapter = new UniswapV3Adapter();
        curveAdapter = new CurveStableSwapAdapter();
        token0.mint(trader, 1_000 ether);
        token1.mint(trader, 1_000 ether);
    }

    function testV2AdapterFundsPairBeforeSwap() public {
        MockV2Pair pair = new MockV2Pair(address(token0), address(token1), 1_000 ether, 1_000 ether);
        uint256 amountIn = 100 ether;
        uint256 amountInWithFee = amountIn * 997;
        uint256 expectedOut = (amountInWithFee * 1_000 ether) / (1_000 ether * 1000 + amountInWithFee);

        vm.startPrank(trader);
        token0.approve(address(v2Adapter), amountIn);
        uint256 amountOut = v2Adapter.swap(
            address(pair), address(token0), address(token1), amountIn, expectedOut, recipient
        );
        vm.stopPrank();

        assertEq(amountOut, expectedOut);
        assertEq(token0.balanceOf(address(pair)), 1_000 ether + amountIn);
        assertEq(token1.balanceOf(recipient), expectedOut);
    }

    function testV2AdapterRejectsInvalidPairTokens() public {
        AdapterMockToken other = new AdapterMockToken("Other", "OTHER");
        MockV2Pair pair = new MockV2Pair(address(token0), address(token1), 1_000 ether, 1_000 ether);

        vm.startPrank(trader);
        other.mint(trader, 100 ether);
        other.approve(address(v2Adapter), 100 ether);
        vm.expectRevert();
        v2Adapter.swap(address(pair), address(other), address(token1), 100 ether, 0, recipient);
        vm.stopPrank();
    }

    function testV3AdapterRejectsCallbackFromNonPool() public {
        vm.expectRevert();
        v3Adapter.uniswapV3SwapCallback(
            int256(100 ether), -int256(90 ether), abi.encode(address(0xBEEF), address(token0), 100 ether)
        );
    }

    function testV3AdapterRejectsCallbackAmountMismatch() public {
        MockV3Pool pool = new MockV3Pool(address(token0), address(token1), 90 ether);
        pool.setMismatchCallbackAmount(true);

        vm.startPrank(trader);
        token0.approve(address(v3Adapter), 100 ether);
        vm.expectRevert();
        v3Adapter.swap(address(pool), address(token0), address(token1), 100 ether, 90 ether, recipient);
        vm.stopPrank();
    }

    function testV3AdapterPaysPoolAndTransfersOutput() public {
        MockV3Pool pool = new MockV3Pool(address(token0), address(token1), 90 ether);

        vm.startPrank(trader);
        token0.approve(address(v3Adapter), 100 ether);
        uint256 amountOut =
            v3Adapter.swap(address(pool), address(token0), address(token1), 100 ether, 90 ether, recipient);
        vm.stopPrank();

        assertEq(amountOut, 90 ether);
        assertEq(token0.balanceOf(address(pool)), 1_000_100 ether);
        assertEq(token1.balanceOf(recipient), 90 ether);
    }

    function testCurveAdapterDiscoversCoinsAndTransfersOutput() public {
        MockCurvePool pool = new MockCurvePool(address(token0), address(token1), 99e16);

        vm.startPrank(trader);
        token0.approve(address(curveAdapter), 100 ether);
        uint256 amountOut =
            curveAdapter.swap(address(pool), address(token0), address(token1), 100 ether, 99 ether, recipient);
        vm.stopPrank();

        assertEq(amountOut, 99 ether);
        assertEq(token0.balanceOf(address(pool)), 1_000_100 ether);
        assertEq(token1.balanceOf(recipient), 99 ether);
        assertEq(token0.allowance(address(curveAdapter), address(pool)), 0);
    }

    function testCurveAdapterRejectsUnknownPoolToken() public {
        AdapterMockToken other = new AdapterMockToken("Other", "OTHER");
        MockCurvePool pool = new MockCurvePool(address(token0), address(token1), 99e16);

        vm.startPrank(trader);
        other.mint(trader, 100 ether);
        other.approve(address(curveAdapter), 100 ether);
        vm.expectRevert();
        curveAdapter.swap(address(pool), address(other), address(token1), 100 ether, 0, recipient);
        vm.stopPrank();
    }

    function testBalancerAdapterUsesPoolIdAndVaultSettlement() public {
        bytes32 poolId = keccak256("pool");
        MockBalancerPool pool = new MockBalancerPool(poolId);
        MockBalancerVault vault = new MockBalancerVault(poolId);
        BalancerV2VaultAdapter adapter = new BalancerV2VaultAdapter(address(vault));
        token1.mint(address(vault), 1_000_000 ether);

        vm.startPrank(trader);
        token0.approve(address(adapter), 100 ether);
        uint256 amountOut =
            adapter.swap(address(pool), address(token0), address(token1), 100 ether, 90 ether, recipient);
        vm.stopPrank();

        assertEq(amountOut, 90 ether);
        assertEq(token0.balanceOf(address(vault)), 100 ether);
        assertEq(token1.balanceOf(recipient), 90 ether);
        assertEq(token0.allowance(address(adapter), address(vault)), 0);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {AaveV3LiquidationExecutor, IAaveV3FlashLoanSimpleReceiver} from "../src/AaveV3LiquidationExecutor.sol";

contract LiquidationMockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}

contract MockAaveV3Pool {
    using SafeERC20 for IERC20;

    uint256 public premiumBps = 9;
    uint256 public collateralReward;

    function setPremiumBps(uint256 premiumBps_) external {
        premiumBps = premiumBps_;
    }

    function setCollateralReward(uint256 collateralReward_) external {
        collateralReward = collateralReward_;
    }

    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16
    ) external {
        uint256 premium = (amount * premiumBps) / 10_000;
        IERC20(asset).safeTransfer(receiverAddress, amount);
        bool ok = IAaveV3FlashLoanSimpleReceiver(receiverAddress).executeOperation(
            asset,
            amount,
            premium,
            msg.sender,
            params
        );
        require(ok, "MockAaveV3Pool: callback failed");
        IERC20(asset).safeTransferFrom(receiverAddress, address(this), amount + premium);
    }

    function liquidationCall(
        address collateralAsset,
        address debtAsset,
        address,
        uint256 debtToCover,
        bool receiveAToken
    ) external {
        require(!receiveAToken, "MockAaveV3Pool: aToken unsupported");
        IERC20(debtAsset).safeTransferFrom(msg.sender, address(this), debtToCover);
        LiquidationMockToken(collateralAsset).mint(msg.sender, collateralReward);
    }
}

contract MockCollateralUnwindRouter {
    using SafeERC20 for IERC20;

    function unwind(
        address collateralAsset,
        address debtAsset,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    ) external {
        IERC20(collateralAsset).safeTransferFrom(msg.sender, address(this), amountIn);
        LiquidationMockToken(debtAsset).mint(recipient, amountOut);
    }
}

contract AaveV3LiquidationExecutorTest is Test {
    LiquidationMockToken debt;
    LiquidationMockToken collateral;
    MockAaveV3Pool pool;
    MockCollateralUnwindRouter router;
    AaveV3LiquidationExecutor executor;

    address admin = address(this);
    address borrower = address(0xB0B);
    address beneficiary = address(0xBEEF);

    function setUp() public {
        debt = new LiquidationMockToken("Debt USD", "dUSD");
        collateral = new LiquidationMockToken("Collateral ETH", "cETH");
        pool = new MockAaveV3Pool();
        router = new MockCollateralUnwindRouter();
        executor = new AaveV3LiquidationExecutor(address(pool), admin);
        executor.setUnwindTarget(address(router), true);

        debt.mint(address(pool), 1_000_000e18);
    }

    function _params(uint256 debtToCover, uint256 collateralReward, uint256 amountOut, uint256 minProfit)
        internal
        returns (AaveV3LiquidationExecutor.LiquidationParams memory params)
    {
        pool.setCollateralReward(collateralReward);
        params = AaveV3LiquidationExecutor.LiquidationParams({
            collateralAsset: address(collateral),
            borrower: borrower,
            debtToCover: debtToCover,
            receiveAToken: false,
            unwindTarget: address(router),
            unwindCalldata: abi.encodeCall(
                MockCollateralUnwindRouter.unwind,
                (address(collateral), address(debt), collateralReward, amountOut, address(executor))
            ),
            minDebtAssetOut: amountOut,
            minProfit: minProfit,
            beneficiary: beneficiary
        });
    }

    function testExecuteLiquidationWithFlashLoanPaysProfit() public {
        uint256 debtToCover = 100e18;
        uint256 premium = (debtToCover * pool.premiumBps()) / 10_000;
        uint256 minProfit = 5e18;
        uint256 amountOut = debtToCover + premium + minProfit;
        uint256 collateralReward = 120e18;

        AaveV3LiquidationExecutor.LiquidationParams memory params =
            _params(debtToCover, collateralReward, amountOut, minProfit);

        executor.executeLiquidation(address(debt), debtToCover, params);

        assertEq(debt.balanceOf(beneficiary), minProfit);
        assertEq(debt.balanceOf(address(executor)), 0);
        assertEq(collateral.balanceOf(address(executor)), 0);
        assertEq(collateral.balanceOf(address(router)), collateralReward);
    }

    function testExecuteLiquidationRevertsWhenProfitBelowFloor() public {
        uint256 debtToCover = 100e18;
        uint256 premium = (debtToCover * pool.premiumBps()) / 10_000;
        uint256 minProfit = 5e18;
        uint256 amountOut = debtToCover + premium + minProfit - 1;

        AaveV3LiquidationExecutor.LiquidationParams memory params =
            _params(debtToCover, 120e18, amountOut, minProfit);

        vm.expectRevert();
        executor.executeLiquidation(address(debt), debtToCover, params);
    }

    function testExecuteOperationRejectsNonPoolCallback() public {
        AaveV3LiquidationExecutor.LiquidationParams memory params =
            _params(100e18, 120e18, 105e18, 1e18);
        bytes memory encoded = abi.encode(address(this), address(debt), params);

        vm.expectRevert(AaveV3LiquidationExecutor.InvalidFlashLoanCallback.selector);
        executor.executeOperation(address(debt), 100e18, 0, address(executor), encoded);
    }

    function testExecuteLiquidationRejectsUnwhitelistedUnwindTarget() public {
        MockCollateralUnwindRouter otherRouter = new MockCollateralUnwindRouter();
        uint256 debtToCover = 100e18;
        uint256 collateralReward = 120e18;
        uint256 amountOut = debtToCover + 1e18;
        pool.setCollateralReward(collateralReward);

        AaveV3LiquidationExecutor.LiquidationParams memory params =
            AaveV3LiquidationExecutor.LiquidationParams({
                collateralAsset: address(collateral),
                borrower: borrower,
                debtToCover: debtToCover,
                receiveAToken: false,
                unwindTarget: address(otherRouter),
                unwindCalldata: abi.encodeCall(
                    MockCollateralUnwindRouter.unwind,
                    (
                        address(collateral),
                        address(debt),
                        collateralReward,
                        amountOut,
                        address(executor)
                    )
                ),
                minDebtAssetOut: amountOut,
                minProfit: 0,
                beneficiary: beneficiary
            });

        vm.expectRevert(
            abi.encodeWithSelector(
                AaveV3LiquidationExecutor.UnwindTargetNotWhitelisted.selector,
                address(otherRouter)
            )
        );
        executor.executeLiquidation(address(debt), debtToCover, params);
    }
}

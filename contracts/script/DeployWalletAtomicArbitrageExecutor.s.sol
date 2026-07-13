// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {WalletAtomicArbitrageExecutor} from "../src/WalletAtomicArbitrageExecutor.sol";
import {UniswapV2Adapter} from "../src/adapters/UniswapV2Adapter.sol";
import {UniswapV3Adapter} from "../src/adapters/UniversalDexAdapter.sol";
import {CurveStableSwapAdapter} from "../src/adapters/CurveStableSwapAdapter.sol";
import {BalancerV2VaultAdapter} from "../src/adapters/BalancerV2VaultAdapter.sol";
import {AerodromeRouterAdapter} from "../src/adapters/AerodromeRouterAdapter.sol";

struct WalletAtomicArbDeployments {
    WalletAtomicArbitrageExecutor executor;
    UniswapV2Adapter uniswapV2Adapter;
    UniswapV3Adapter uniswapV3Adapter;
    CurveStableSwapAdapter curveStableSwapAdapter;
    BalancerV2VaultAdapter balancerV2VaultAdapter;
    AerodromeRouterAdapter aerodromeStableAdapter;
    AerodromeRouterAdapter aerodromeVolatileAdapter;
}

/// @notice Deploys the wallet-first atomic arbitrage executor plus canonical
///         adapter contracts used by DEX, Curve, and Balancer pure-arb routes.
///         Run:
///         forge script script/DeployWalletAtomicArbitrageExecutor.s.sol \
///           --rpc-url $RPC_ETHEREUM_URL --broadcast --private-key $PRIVATE_KEY \
///           --tc DeployWalletAtomicArbitrageExecutorScript
///
///         Optional env:
///         - WALLET_ARB_ADMIN overrides vm.addr(PRIVATE_KEY).
///         - BALANCER_VAULT deploys and whitelists BalancerV2VaultAdapter.
///         - AERODROME_ROUTER and AERODROME_FACTORY deploy and whitelist stable/volatile Aerodrome adapters.
contract DeployWalletAtomicArbitrageExecutorScript is Script {
    function run() public returns (WalletAtomicArbDeployments memory d) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.envOr("WALLET_ARB_ADMIN", vm.addr(privateKey));
        address balancerVault = vm.envOr("BALANCER_VAULT", address(0));
        address aerodromeRouter = vm.envOr("AERODROME_ROUTER", address(0));
        address aerodromeFactory = vm.envOr("AERODROME_FACTORY", address(0));
        if (admin == address(0)) revert("WALLET_ARB_ADMIN cannot be zero");

        vm.startBroadcast(privateKey);
        d.executor = new WalletAtomicArbitrageExecutor(admin);
        d.uniswapV2Adapter = new UniswapV2Adapter();
        d.uniswapV3Adapter = new UniswapV3Adapter();
        d.curveStableSwapAdapter = new CurveStableSwapAdapter();

        d.executor.whitelistAdapter(address(d.uniswapV2Adapter), true);
        d.executor.whitelistAdapter(address(d.uniswapV3Adapter), true);
        d.executor.whitelistAdapter(address(d.curveStableSwapAdapter), true);

        if (balancerVault != address(0)) {
            d.balancerV2VaultAdapter = new BalancerV2VaultAdapter(balancerVault);
            d.executor.whitelistAdapter(address(d.balancerV2VaultAdapter), true);
        }
        if (aerodromeRouter != address(0) || aerodromeFactory != address(0)) {
            if (aerodromeRouter == address(0) || aerodromeFactory == address(0)) {
                revert("AERODROME_ROUTER and AERODROME_FACTORY must both be set");
            }
            d.aerodromeStableAdapter = new AerodromeRouterAdapter(aerodromeRouter, aerodromeFactory, true);
            d.aerodromeVolatileAdapter = new AerodromeRouterAdapter(aerodromeRouter, aerodromeFactory, false);
            d.executor.whitelistAdapter(address(d.aerodromeStableAdapter), true);
            d.executor.whitelistAdapter(address(d.aerodromeVolatileAdapter), true);
        }
        vm.stopBroadcast();

        console2.log("WalletAtomicArbitrageExecutor: chainId", block.chainid);
        console2.log("WalletAtomicArbitrageExecutor: admin", admin);
        console2.log("WalletAtomicArbitrageExecutor: executor", address(d.executor));
        console2.log("WalletAtomicArbitrageExecutor: uniswapV2Adapter", address(d.uniswapV2Adapter));
        console2.log("WalletAtomicArbitrageExecutor: uniswapV3Adapter", address(d.uniswapV3Adapter));
        console2.log("WalletAtomicArbitrageExecutor: curveStableSwapAdapter", address(d.curveStableSwapAdapter));
        console2.log("WalletAtomicArbitrageExecutor: balancerV2VaultAdapter", address(d.balancerV2VaultAdapter));
        console2.log("WalletAtomicArbitrageExecutor: balancerVault", balancerVault);
        console2.log("WalletAtomicArbitrageExecutor: aerodromeStableAdapter", address(d.aerodromeStableAdapter));
        console2.log("WalletAtomicArbitrageExecutor: aerodromeVolatileAdapter", address(d.aerodromeVolatileAdapter));
        console2.log("WalletAtomicArbitrageExecutor: aerodromeRouter", aerodromeRouter);
        console2.log("WalletAtomicArbitrageExecutor: aerodromeFactory", aerodromeFactory);
    }
}

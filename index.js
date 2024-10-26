const { AptosClient, AptosAccount, Types,CoinClient, HexString } = require("aptos");
const NODE_URL = "https://fullnode.mainnet.aptoslabs.com";
const CONTRACT_ADDRESS = "0x8bfe94ea45bd7abbf159536e6d5b0219c6dbf141ada169ae24fb5e2e9a79ec5d";
const PRIVATE_KEY = "你的密钥";
const MAX_MINT_TIMES = 100;
const SLEEP_TIME = 1_000;
const RECEIVER_ADDRESS = "0x9bf9b46db01cfe9e93403594eecca9154e5cfdd2ee0e543cc76d32a884be480e";  // 指定 LAMA 的接收地址
const client = new AptosClient(NODE_URL);
const coinClient = new CoinClient(client);

async function checkAccountBalance(accountAddress) {
    try {
        const resources = await client.getAccountResources(accountAddress);
        const aptosCoinResource = resources.find(r => r.type === "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>");
        return aptosCoinResource ? BigInt(aptosCoinResource.data.coin.value) : BigInt(0);
    } catch (error) {
        console.error('余额检查失败:', error);
        throw error;
    }
}
function displayTransactionResult(result, event = false, change = false) {
    console.log('\n交易执行结果:');
    console.log('----------------------------------------');
    console.log(`状态: ${result.success ? '成功' : '失败'}`);
    console.log(`交易哈希: ${result.hash}`);
    console.log(`发送地址: ${result.sender}`);
    console.log(`执行时间: ${result.timestamp}`);
    console.log(`使用Gas: ${result.gas_used}`);
    console.log(`VM状态: ${result.vm_status}`);
    console.log('----------------------------------------');

    if (event && result.events && result.events.length > 0) {
        console.log('\n触发的事件:');
        result.events.forEach((event, index) => {
            console.log(`\n事件 ${index + 1}:`);
            console.log(`类型: ${event.type}`);
            console.log(`数据: ${JSON.stringify(event.data, null, 2)}`);
        });
    }

    if (change && result.changes && result.changes.length > 0) {
        console.log('\n状态变更:');
        result.changes.forEach((change, index) => {
            console.log(`\n变更 ${index + 1}:`);
            console.log(`类型: ${change.type}`);
            console.log(`地址: ${change.address}`);
            if (change.data) {
                console.log(`数据: ${JSON.stringify(change.data, null, 2)}`);
            }
        });
    }
}
async function checkWalletMintInfo(accountAddress) {
    try {
        const resources = await client.getAccountResources(accountAddress);
        const mintInfo = resources.find(r => r.type === `${CONTRACT_ADDRESS}::lama::WalletMintInfo`);
        return mintInfo ? { hasMintInfo: true, mintTimes: Number(mintInfo.data.mint_times) } : { hasMintInfo: false, mintTimes: 0 };
    } catch (error) {
        console.error('检查WalletMintInfo失败:', error);
        throw error;
    }
}

async function transferLAMA(account, receiverAddress) {
    try {
        const payload = {
            type: "entry_function_payload",
            function: "0x1::aptos_account::transfer_coins",
            type_arguments: ["0x8bfe94ea45bd7abbf159536e6d5b0219c6dbf141ada169ae24fb5e2e9a79ec5d::lama::Coin"],
            arguments: [receiverAddress, "100000"]  
        };
        const txnRequest = await client.generateTransaction(account.address(), payload, {
            max_gas_amount: "2000",
            gas_unit_price: "100",
            expiration_timestamp_secs: Math.floor(Date.now() / 1000) + 600,
        });
        const signedTxn = await client.signTransaction(account, txnRequest);
        const txnResult = await client.submitTransaction(signedTxn);
        await client.waitForTransaction(txnResult.hash);
        console.log(`成功转账 LAMA 到地址 ${receiverAddress}`);
    } catch (error) {
        console.error("LAMA 转账失败:", error);
        throw error;
    }
}

async function mintToken(account) {
    try {
        const payload = {
            type: "entry_function_payload",
            function: `${CONTRACT_ADDRESS}::lama::mint`,
            type_arguments: [],
            arguments: []
        };
        const rawTxn = await client.generateTransaction(account.address(), payload, {
            max_gas_amount: "20000",
            gas_unit_price: "100",
            expiration_timestamp_secs: Math.floor(Date.now() / 1000) + 600,
        });
        const bcsTxn = await client.signTransaction(account, rawTxn);
        const pendingTxn = await client.submitTransaction(bcsTxn);
        return await client.waitForTransactionWithResult(pendingTxn.hash);
    } catch (error) {
        console.error('铸造失败:', error);
        throw error;
    }
}

async function createNewAccountAndTransferAPT(currentAccount) {
    const newAccount = new AptosAccount();
    const balance = await checkAccountBalance(currentAccount.address());
    console.log(`当前账户余额: ${balance} APT，准备转入新账户: ${newAccount.address().hex()}`);

    try {
        const amo = balance.toString() - 100000;
        const transaction = await coinClient.transfer(
            currentAccount,                    // 发送方账户
            newAccount.address().hex(),          // 接收方地址
            BigInt(amo.toString()),   // 转账金额(Octas)
            {
            gasUnitPrice: BigInt(100),  // Gas 单价
            maxGasAmount: BigInt(10000) // 最大 Gas 限制
            }
        );
        const result = await client.waitForTransaction(transaction);
        console.log(`成功将 APT 转移到新账户: ${newAccount.address().hex()}`);
        // 获取并打印新账户的私钥
        const privateKeyHex = newAccount.toPrivateKeyObject().privateKeyHex;
        console.log(`新账户地址: ${newAccount.address().hex()}`);
        console.log(`新账户私钥: ${privateKeyHex}`);

        return newAccount;
    } catch (error) {
        console.error("APT 转移到新账户失败:", error);
        throw error;
    }
}

async function main() {
    try {
        let account = new AptosAccount(HexString.ensure(PRIVATE_KEY).toUint8Array());
        console.log("账户地址:", account.address().hex());

        while (true) {
            const { hasMintInfo, mintTimes } = await checkWalletMintInfo(account.address());

            // 如果已经有WalletMintInfo且达到最大次数则退出
            if (hasMintInfo && mintTimes >= MAX_MINT_TIMES) {
                console.log(`\n已达到最大mint次数 ${MAX_MINT_TIMES},转账`);
                await transferLAMA(account, RECEIVER_ADDRESS);
                account = await createNewAccountAndTransferAPT(account);
                continue;
            }

            // 显示当前状态
            if (hasMintInfo) {
                console.log(`\n当前mint次数: ${mintTimes}`);
                console.log(`\n开始第 ${mintTimes + 1} 次铸造...`);
            } else {
                console.log("\n首次mint,无WalletMintInfo...");
            }

            const result = await mintToken(account);
            displayTransactionResult(result);
            //console.log("铸造结果:", result);
// 如果是首次mint,再次检查是否成功创建了WalletMintInfo
            if (!hasMintInfo) {
                const checkResult = await checkWalletMintInfo(account.address());
                if (!checkResult.hasMintInfo) {
                    console.log("\nWalletMintInfo创建失败,请检查交易...");
                    break;
                }
            }
            console.log(`等待${SLEEP_TIME / 100}秒后继续下一次mint...`);
            await new Promise(resolve => setTimeout(resolve, SLEEP_TIME));
        }
    } catch (error) {
        console.error('\n发生错误:', error.message);
        if (error.message.includes('余额不足')) {
            console.log('请确保您的账户有足够的APT支付gas费用');
        }
    }
}

// 运行主函数
console.log("开始LAMA代币自动铸造过程...");
main().then(() => {
    console.log("\n程序执行完成");
}).catch((error) => {
    console.error("\n程序执行失败:", error);
    process.exit(1);
});

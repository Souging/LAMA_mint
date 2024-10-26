const { AptosClient, AptosAccount, Types, HexString } = require("aptos");

// 配置常量
const NODE_URL = "https://fullnode.mainnet.aptoslabs.com";
const CONTRACT_ADDRESS = "0x8bfe94ea45bd7abbf159536e6d5b0219c6dbf141ada169ae24fb5e2e9a79ec5d";
const PRIVATE_KEY = "你的密钥";
const MAX_MINT_TIMES = 100;
const SLEEP_TIME = 1_000;


// 创建 Aptos 客户端实例
const client = new AptosClient(NODE_URL);

// 检查账户余额
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

// 检查是否有WalletMintInfo以及mint次数
async function checkWalletMintInfo(accountAddress) {
    try {
        const resources = await client.getAccountResources(accountAddress);
        const mintInfo = resources.find(r => r.type === `${CONTRACT_ADDRESS}::lama::WalletMintInfo`);

        if (!mintInfo) {
            return { hasMintInfo: false, mintTimes: 0 };
        }

        return {
            hasMintInfo: true,
            mintTimes: Number(mintInfo.data.mint_times)
        };
    } catch (error) {
        console.error('检查WalletMintInfo失败:', error);
        throw error;
    }
}

// 格式化交易结果
function formatTransactionResult(result) {
    try {
        return {
            type: result.type,
            success: result.success,
            vmStatus: result.vm_status,
            gasUsed: result.gas_used,
            hash: result.hash,
            sender: result.sender,
            sequenceNumber: result.sequence_number,
            timestamp: new Date(parseInt(result.timestamp) / 1000).toLocaleString(),
            version: result.version,
            events: result.events || [],
            changes: result.changes || []
        };
    } catch (error) {
        console.error('格式化交易结果失败:', error);
        return null;
    }
}

// 延迟函数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function mintToken(account) {
    try {
        // 检查账户余额
        const balance = await checkAccountBalance(account.address());
        console.log(`当前账户余额: ${balance} APT`);

        if (balance < BigInt(100000)) {
            throw new Error('账户余额不足以支付gas费用');
        }

        console.log("\n准备铸造交易...");
        const payload = {
            type: "entry_function_payload",
            function: `${CONTRACT_ADDRESS}::lama::mint`,
            type_arguments: [],
            arguments: []
        };

        console.log("生成交易...");
        const rawTxn = await client.generateTransaction(
            account.address(),
            payload,
            {
                max_gas_amount: "20000",
                gas_unit_price: "100",
                expiration_timestamp_secs: Math.floor(Date.now() / 1000) + 600,
            }
        );

        console.log("签署交易...");
        const bcsTxn = await client.signTransaction(account, rawTxn);

        console.log("提交交易并等待结果...");
        const pendingTxn = await client.submitTransaction(bcsTxn);

        const result = await client.waitForTransactionWithResult(pendingTxn.hash);
        return formatTransactionResult(result);
    } catch (error) {
        console.error('铸造失败:', error);
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
    console.log(`使用Gas: ${result.gasUsed}`);
    console.log(`VM状态: ${result.vmStatus}`);
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

async function main() {
    try {
        console.log("\n初始化铸造过程...");

        const account = new AptosAccount(
            HexString.ensure(PRIVATE_KEY).toUint8Array()
        );

        console.log("账户地址:", account.address().hex());

        while (true) {
            // 检查WalletMintInfo
            const { hasMintInfo, mintTimes } = await checkWalletMintInfo(account.address());

            // 如果已经有WalletMintInfo且达到最大次数则退出
            if (hasMintInfo && mintTimes >= MAX_MINT_TIMES) {
                console.log(`\n已达到最大mint次数 ${MAX_MINT_TIMES},退出程序`);
                break;
            }

            // 显示当前状态
            if (hasMintInfo) {
                console.log(`\n当前mint次数: ${mintTimes}`);
                console.log(`\n开始第 ${mintTimes + 1} 次铸造...`);
            } else {
                console.log("\n首次mint,无WalletMintInfo...");
            }

            // 执行mint
            const result = await mintToken(account);
            displayTransactionResult(result);

            // 如果是首次mint,再次检查是否成功创建了WalletMintInfo
            if (!hasMintInfo) {
                const checkResult = await checkWalletMintInfo(account.address());
                if (!checkResult.hasMintInfo) {
                    console.log("\nWalletMintInfo创建失败,请检查交易...");
                    break;
                }
            }

            // 等待10秒后继续下一次mint
            console.log(`等待${SLEEP_TIME / 1000}秒后继续下一次mint...`);
            await sleep(SLEEP_TIME);
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

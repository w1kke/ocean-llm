const fetch = require('node-fetch');

const OCEAN_SUBGRAPH_URL = {
    1: 'https://v4.subgraph.mainnet.oceanprotocol.com/subgraphs/name/oceanprotocol/ocean-subgraph',
    11155111: 'https://v4.subgraph.sepolia.oceanprotocol.com/subgraphs/name/oceanprotocol/ocean-subgraph',
    137: 'https://v4.subgraph.polygon.oceanprotocol.com/subgraphs/name/oceanprotocol/ocean-subgraph'
};

async function querySubgraph(chainId, query, variables) {
    const subgraphUrl = OCEAN_SUBGRAPH_URL[chainId];
    if (!subgraphUrl) {
        throw new Error(`No subgraph URL defined for chainId ${chainId}`);
    }

    const response = await fetch(subgraphUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            query,
            variables
        })
    });

    const data = await response.json();
    if (data.errors) {
        throw new Error(`Subgraph query failed: ${JSON.stringify(data.errors)}`);
    }

    return data.data;
}

async function getUserOrders(userAddress, chainId) {
    const query = `
        query OrdersData($user: String!) {
            orders(
                orderBy: createdTimestamp
                orderDirection: desc
                where: { consumer: $user }
            ) {
                id
                consumer {
                    id
                }
                datatoken {
                    id
                    address
                    symbol
                    name
                }
                createdTimestamp
                tx
                serviceIndex
            }
        }
    `;

    const variables = {
        user: userAddress.toLowerCase()
    };

    try {
        console.log('[DEBUG] Querying subgraph for orders:', { userAddress, chainId });
        const data = await querySubgraph(chainId, query, variables);
        
        // Enhanced logging with readable timestamps
        const ordersWithReadableTime = data.orders.map(order => ({
            ...order,
            readableTime: new Date(order.createdTimestamp * 1000).toISOString(),
            datatokenAddress: order.datatoken.address
        }));
        
        /*
        console.log('[DEBUG] Subgraph response:', {
            totalOrders: ordersWithReadableTime.length,
            orders: ordersWithReadableTime.map(order => ({
                tx: order.tx,
                datatokenAddress: order.datatokenAddress,
                symbol: order.datatoken.symbol,
                time: order.readableTime
            }))
        });
        */
        return data.orders;
    } catch (error) {
        console.error('[ERROR] Failed to fetch user orders:', error);
        throw error;
    }
}

async function hasUserPurchased(userAddress, datatokenAddress, chainId) {
    try {
        const orders = await getUserOrders(userAddress, chainId);
        const matchingOrders = orders.filter(order => 
            order.datatoken.address.toLowerCase() === datatokenAddress.toLowerCase()
        );
        
        const hasPurchased = matchingOrders.length > 0;
        /*
        console.log('[DEBUG] Purchase check result:', {
            userAddress,
            datatokenAddress,
            hasPurchased,
            ordersFound: orders.length,
            matchingOrders: matchingOrders.map(order => ({
                tx: order.tx,
                time: new Date(order.createdTimestamp * 1000).toISOString(),
                symbol: order.datatoken.symbol
            }))
        });    
        */
        return hasPurchased;
    } catch (error) {
        console.error('[ERROR] Failed to check purchase status:', error);
        return false;
    }
}

module.exports = {
    getUserOrders,
    hasUserPurchased
}; 
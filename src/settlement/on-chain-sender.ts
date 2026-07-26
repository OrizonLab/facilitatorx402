import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Chain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'

const ERC3009_ABI = [
  {
    name: 'transferWithAuthorization',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from',        type: 'address' },
      { name: 'to',          type: 'address' },
      { name: 'value',       type: 'uint256' },
      { name: 'validAfter',  type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce',       type: 'bytes32' },
      { name: 'v',           type: 'uint8'   },
      { name: 'w',           type: 'bytes32' },
      { name: 'y',           type: 'bytes32' },
    ],
    outputs: [],
  },
] as const

export interface OnChainSendParams {
  contractAddress: Address
  from: Address
  to: Address
  value: bigint
  validAfter: bigint
  validBefore: bigint
  nonce: Hex
  signature: Hex   // 65-byte EIP-712 signature (r+s+v)
  rpcUrl: string
  relayerPrivateKey: Hex
  chain?: Chain
  requiredConfirmations?: number
  confirmationTimeoutMs?: number
}

export interface OnChainSendResult {
  txHash: Hex
  blockNumber: bigint
  gasUsed: bigint
}

/**
 * Split a 65-byte EIP-712 signature into r, s, v components.
 */
function splitSignature(sig: Hex): { r: Hex; s: Hex; v: number } {
  const hex = sig.slice(2) // remove 0x
  const r = `0x${hex.slice(0, 64)}` as Hex
  const s = `0x${hex.slice(64, 128)}` as Hex
  const v = parseInt(hex.slice(128, 130), 16)
  return { r, s, v }
}

/**
 * Submit a TransferWithAuthorization transaction on-chain.
 * Waits for the required number of confirmations.
 */
export async function sendTransferWithAuthorization(
  params: OnChainSendParams,
): Promise<OnChainSendResult> {
  const {
    contractAddress, from, to, value, validAfter, validBefore, nonce,
    signature, rpcUrl, relayerPrivateKey,
    chain = base,
    requiredConfirmations = parseInt(process.env.REQUIRED_CONFIRMATIONS ?? '1', 10),
    confirmationTimeoutMs = parseInt(process.env.CONFIRMATION_TIMEOUT_MS ?? '120000', 10),
  } = params

  const account = privateKeyToAccount(relayerPrivateKey)

  const publicClient: PublicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  const walletClient: WalletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })

  const { r, s, v } = splitSignature(signature)

  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: ERC3009_ABI,
    functionName: 'transferWithAuthorization',
    args: [from, to, value, validAfter, validBefore, nonce, v, r, s],
  })

  // Wait for confirmations with timeout
  const receipt = await Promise.race([
    publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: requiredConfirmations,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Confirmation timeout after ${confirmationTimeoutMs}ms`)),
        confirmationTimeoutMs,
      )
    ),
  ])

  if (receipt.status === 'reverted') {
    throw new Error(`Transaction reverted: ${txHash}`)
  }

  return {
    txHash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
  }
}

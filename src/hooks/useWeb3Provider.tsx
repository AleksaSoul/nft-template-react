import { BigNumber, Contract, ethers } from 'ethers'
import { useEffect, useState } from 'react'
import { toast } from 'react-toastify'
import { CONTRACT_ADDRESS } from '../lib/config'
import nftAbi from '../lib/nftAbi'
import { sleep } from '../lib/helpers'
import { fetchMyNftIDs, initProvider } from '../lib/utils'

export interface IWeb3State {
  currentChain: number | null
  children: Child[]
  collectionInfo: CollectionInfo | null
  contracts: Record<string, Contract>
  filterByWallet: boolean
  isAuthenticated: boolean
  isNestable: boolean
  loadingChildren: boolean
  loadingMyNfts: boolean
  loadingNft: boolean
  loadingNfts: boolean
  loadingPendingChildren: boolean
  myNftIDs: Array<number>
  nft: Nft | undefined
  nfts: Array<Nft>
  pendingChildren: Child[]
  provider: Provider | null
  signer: Signer | null
  walletAddress: string
}

export const initialWeb3State = {
  currentChain: null,
  children: [],
  collectionInfo: null,
  contracts: {},
  filterByWallet: false,
  isAuthenticated: false,
  isNestable: false,
  loadingChildren: false,
  loadingPendingChildren: false,
  loadingNft: false,
  loadingNfts: false,
  loadingMyNfts: false,
  myNftIDs: [],
  nft: undefined,
  nfts: [],
  pendingChildren: [],
  provider: null,
  signer: null,
  walletAddress: ''
}

const useWeb3Provider = () => {
  const [state, setState] = useState<IWeb3State>(initialWeb3State)

  const getProvider = () => {
    return state.provider || initProvider()
  }

  const getSigner = async () => {
    return state.signer || getProvider().getSigner()
  }

  const initContract = (contractAddress?: string, provider?: Provider) => {
    return new ethers.Contract(contractAddress || CONTRACT_ADDRESS, nftAbi, provider || initProvider())
  }

  const disconnect = () => {
    setState(initialWeb3State)
    localStorage.removeItem('isAuthenticated')
  }

  function getContract(contractAddress?: string): Contract {
    const address = contractAddress || CONTRACT_ADDRESS

    if (!Object.keys(state.contracts).includes(address)) {
      const contracts = state.contracts
      const newContract = initContract(address, getProvider())
      contracts[address] = newContract
      setState({
        ...state,
        contracts
      })
      return newContract
    }
    return state.contracts[address]
  }

  async function getCollectionInfo(contract: Contract) {
    state.collectionInfo = {
      name: await contract.name(),
      address: contract.address,
      symbol: await contract.symbol(),
      maxSupply: await contract.maxSupply(),
      totalSupply: await contract.totalSupply(),
      soulbound: await contract.isSoulbound(),
      revokable: await contract.isRevokable(),
      drop: await contract.isDrop(),
      dropStart: await contract.dropStart(),
      reserve: await contract.reserve(),
      price: await contract.pricePerMint(),
      royaltiesFees: await contract.getRoyaltyPercentage(),
      royaltiesAddress: await contract.getRoyaltyRecipient()
    }
    setState(state)
    return state.collectionInfo
  }
  async function getCollectionTotalSupply(contract: Contract): Promise<BigNumber> {
    const totalSupply = await contract.totalSupply()
    if (state.collectionInfo) {
      state.collectionInfo.totalSupply = totalSupply
      setState({ ...state, collectionInfo: { ...state.collectionInfo, totalSupply } })
    }
    return totalSupply
  }

  async function getMyNftIDs(contractAddress?: string) {
    state.myNftIDs = state.walletAddress ? await fetchMyNftIDs(getContract(contractAddress), state.walletAddress) : []
    setState(state)
    return state.myNftIDs
  }

  function getNft(nftId: number) {
    state.nft = state.nfts.find((item) => item.id === nftId)
    setState(state)
    return state.nft
  }

  async function getNfts() {
    state.loadingNfts = true
    filterNfts(false)

    if (state.collectionInfo) {
      state.nfts = await fetchNFTs(state.collectionInfo.totalSupply)
    }
    await sleep(20000)

    state.loadingNfts = false
    setState(state)
    return state.nfts
  }

  async function getChildren(parentId: number, tokenAddress?: string) {
    state.loadingChildren = true
    setState(state)
    state.children = await fetchChildren(parentId, tokenAddress)

    state.loadingChildren = false
    setState(state)
  }

  async function getPendingChildren(parentId: number, tokenAddress?: string) {
    state.loadingPendingChildren = true
    state.pendingChildren = await fetchPendingChildren(parentId, tokenAddress)
    state.loadingPendingChildren = false
  }

  async function fetchNFTs(balance: BigNumber) {
    const nfts = [] as Array<Nft>
    if (balance.toNumber() === 0) {
      return nfts
    }

    try {
      const contract = getContract()
      const promises: Promise<any>[] = []

      for (let i = 0; i < balance.toNumber(); i++) {
        const id = await contract.tokenByIndex(i)

        promises.push(
          new Promise<void>((resolve) => {
            fetchNftById(contract, id.toNumber()).then((metadata) => {
              if (metadata && metadata.name) {
                nfts.push(metadata)
              }
              resolve()
            })
          })
        )
      }
      await Promise.all(promises)
    } catch (e) {
      console.error(e)

      toast('Apologies, we were unable to load NFTs metadata.', {
        type: 'error'
      })
    }
    return nfts
  }

  async function fetchNftById(contract: any, id: number): Promise<Nft | null> {
    try {
      const url = await contract.tokenURI(Number(id))
      const metadata = await fetch(url).then((response) => {
        return response.json()
      })
      return {
        id,
        ...metadata
      }
    } catch (e) {
      console.error(e)

      toast('Apologies, we were unable to load NFT metadata.', {
        type: 'error'
      })
    }
    return null
  }

  async function fetchChildren(parentId: number, tokenAddress?: string) {
    try {
      const nftContract = getContract(tokenAddress)
      return await nftContract.connect(await getSigner()).childrenOf(parentId)
    } catch (e) {
      console.log(e)
      return []
    }
  }
  async function fetchPendingChildren(parentId: number, tokenAddress?: string) {
    try {
      const nftContract = getContract(tokenAddress)
      return await nftContract.connect(await getSigner()).pendingChildrenOf(parentId)
    } catch (e) {
      console.log(e)
      return []
    }
  }

  async function refreshNfts(contract: Contract) {
    const total = await getCollectionTotalSupply(contract)

    state.myNftIDs = state.walletAddress ? await fetchMyNftIDs(contract, state.walletAddress) : []
    setState(state)

    state.nfts = await fetchNFTs(total)
    setState(state)
  }

  function filterNfts(filterByWallet: boolean) {
    state.filterByWallet = filterByWallet
    setState({ ...state, filterByWallet })
  }

  function resetNft() {
    state.nft = undefined
    setState(state)
  }

  useEffect(() => {
    if (typeof window.ethereum === 'undefined') return

    window.ethereum.on('accountsChanged', () => {
      disconnect()
    })

    window.ethereum.on('networkChanged', () => {
      disconnect()
    })

    return () => {
      window.ethereum?.removeAllListeners()
    }
  }, [state])

  return {
    disconnect,
    filterNfts,
    initContract,
    getChildren,
    getCollectionInfo,
    getContract,
    getMyNftIDs,
    getNft,
    getNfts,
    getPendingChildren,
    getProvider,
    getSigner,
    refreshNfts,
    resetNft,
    setState,
    state
  }
}

export default useWeb3Provider

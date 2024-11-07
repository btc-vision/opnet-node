# OP_NET Upcoming Changes

This repository contains all the proposal regarding OP_NET and it's changelog.

## OP_NET 1.1.0 (pre-alpha) - What's Coming in the next OP_NET Update?

### 1. New RPC Methods [In Progress]

#### Breaking Change: `btc_simulate`
- **Overview:** The `btc_simulate` method has been significantly enhanced to support more complex simulations.
- **New Features:**
  - State overwrites.
  - Contract code insertion or overwriting by address.
  - Multiple transaction simulations in a sequence (e.g., a -> b -> c).
- **Simulation Actions:**
  - Define an optional sender for contracts.
  - Override custom states.
  - Define or overwrite contract code at specific addresses.
  - Simulate multiple transactions in a chain.
- **Simulation Results:**
  1. Affected states for each transaction with their values.
  2. Transaction receipts, including events, reverts, etc.
  3. Gas estimation for each transaction (convertible to sat).

#### New RPC Method: `btc_fee`
- **Purpose:** Returns the current estimated Bitcoin mining fees based on the last three blocks.
- **Response:**
  1. **Low:** Lowest estimated fee.
  2. **Normal:** Standard fee.
  3. **Priority:** Highest estimated fee for faster confirmation.

#### New RPC Method: `btc_gas`
- **Purpose:** Provides gas usage data to estimate the fee required for priority transactions.
- **Response:**
  1. **Top:** Average priority fee over the last three blocks.
  2. **Optimal:** Median priority fee for the last block.
  3. **Rate:** Projected future usage.

#### New RPC Method: `btc_chaininfo`
- **Purpose:** Returns detailed information about the current chain and OP_NET status.
- **Response Example:**
  ```json
  {                                           (json object)
	  "chain" : "str",                        (string) current network name (main, test, regtest)
	  "blocks" : n,                           (numeric) the height of the most-work fully-validated chain. The genesis block has height 0
	  "headers" : n,                          (numeric) the current number of headers we have validated
	  "bestBlockHash" : "str",                (string) the hash of the currently best block
	  "difficulty" : n,                       (numeric) the current difficulty
	  "medianTime" : n,                       (numeric) median time for the current best block
	  "verificationProgress" : n,             (numeric) estimate of verification progress [0..1]
	  "initialBlockDownload" : true|false,    (boolean) (debug information) estimate of whether this node is in Initial Block Download mode
	  "chainWork" : "hex",                    (string) total amount of work in active chain, in hexadecimal
	  "softforks" : {                         (json object) status of softforks
		"xxxx" : {                            (json object) name of the softfork
		  "type" : "str",                     (string) one of "buried", "bip9"
		  "bip9" : {                          (json object) status of bip9 softforks (only for "bip9" type)
			"status" : "str",                 (string) one of "defined", "started", "locked_in", "active", "failed"
			"bit" : n,                        (numeric) the bit (0-28) in the block version field used to signal this softfork (only for "started" status)
			"startTime" : xxx,                (numeric) the minimum median time past of a block at which the bit gains its meaning
			"timeout" : xxx,                  (numeric) the median time past of a block at which the deployment is considered failed if not yet locked in
			"since" : n,                      (numeric) height of the first block to which the status applies
			"statistics" : {                  (json object) numeric statistics about BIP9 signalling for a softfork (only for "started" status)
			  "period" : n,                   (numeric) the length in blocks of the BIP9 signalling period
			  "threshold" : n,                (numeric) the number of blocks with the version bit set required to activate the feature
			  "elapsed" : n,                  (numeric) the number of blocks elapsed since the beginning of the current period
			  "count" : n,                    (numeric) the number of blocks with the version bit set in the current period
			  "possible" : true|false         (boolean) returns false if there are not enough blocks left in this period to pass activation threshold
			}
		  },
		  "height" : n,                       (numeric) height of the first block which the rules are or will be enforced (only for "buried" type, or "bip9" type with "active" status)
		  "active" : true|false               (boolean) true if the rules are enforced for the mempool and the next block
		},
	  },
	  "opnet": {
		"consensus": n, 					   (numeric) current OP_NET consensus
		"height": n,						   (numeric) current OP_NET block height
		"gasToSat": n,						   (numeric) the ratio of the current gas to sat
		"epoch": n, 						   (numeric) current OP_NET epoch height
		"bestEpochHash": "str" 				   (string) the hash of the current best epoch
	  }
	}
  ```

#### Modification: `btc_getUTXOs`
- **Breaking Change:** The method now takes an object parameter with additional filtering options.
- **New Parameters Example:**
  ```json
	{
		"query": {
			"address": "str", (string) 
			"filterOrdinals": true|false, (boolean) Filter ordinals UTXOs
			"pending": true|false, (boolean) (optional) return only pending UTXOs
		}[],
		"requiredAmount": n, (numeric) (optional) return at least x amount in sat, otherwise, throw.
	}
  ```

#### Modification: `btc_getBalance`
- **New Parameter:** `includePendingBalance` added to the existing address and filterOrdinals parameters.
- **Response:** Remains unchanged.

### 2. Support for WebSockets [In Progress]
- **Overview:** RPC methods can now be called via WebSocket for improved speed.
- **Event Subscriptions:**
  1. On "block"
  2. On "transaction"
  3. On "epoch"
  4. On "nextBestEpoch"

### 3. Contract Updates [✔️ Completed]

#### Runtime Breaking Changes:
- **Renaming:**
  - `callee` is now `origin` (represents who sent the transaction).
  - `caller` is now `sender` (represents the original sender).
- **New Additions:**
  - Solidity-like constructor method (`onInstantiated`).
  - OP_20 uses storage slots for defining constant properties, allowing deployment from a factory contract.
  - New `StoredBoolean` type added.

### 4. Pending UTXO Tracking [✔️ Completed]
- **Feature:** OP_NET now tracks pending UTXOs.

---

## OP_NET 1.1.1 (pre-alpha) - What's Coming After This Update?

### 1. New RPC Methods

#### `btc_epoch`
- **Purpose:** Returns information about the latest or specified OP_NET epoch.
- **Parameters Example:**
  ```json
  {
    "height": 123
  }
  ```
- **Response Example:**
  ```json
	{
		"height": n, (numeric) current epoch height
		"timestamp": n, (numeric) timestamp of the epoch
		"hash": "str",(string) current epoch hash
		"job": "str", (string) epoch unique job hash
		"proposedBy": "str", (string) identity of the validator that proposed this epoch
		"graffiti": "str", (string) (optional) custom graffiti set by the validator who proposed this epoch
		"reward": n, (numeric) reward in WBTC collected in this epoch by the validator who proposed the best solution,
		"validators": n, (numeric) amount of validators (untrusted-permissionless) who accepted this epoch
		"trustedValidators": string[], (identity of trusted validators who accepted this epoch)
		"txCount": n, (numeric) amount of transactions in this epoch
		"transactions": [...string], (array) list of OP_NET transaction hash included in this epoch, generated from partially signed PSBT
		"psbt": string[], (array) (optional) list of all the raw psbts included in this epoch),
		"vaultUTXOs": { transactionId: "str", outputIndex: n }[], (array) list of all the potential vault UTXOs used in this epoch
		"proofs": string[], (array) proof that this epoch is valid
	}
  ```

#### `btc_nextEpoch`
- **Purpose:** Retrieves the best proposed epoch.
- **Response Example:**
  ```json
	{
		"height": n, (numeric) current epoch height
		"proposal": "str" (string) proposal proof
		"timestamp": n, (numeric) timestamp of the epoch
		"job": "str", (string) epoch unique job hash
		"proposedBy": "str", (string) identity of the validator that proposed this epoch
		"graffiti": "str", (string) (optional) custom graffiti set by the validator who proposed this epoch
		"txCount": n, (numeric) amount of transactions in this epoch
		"transactions": [...string], (array) list of OP_NET transaction hash included in this epoch, generated from partially signed PSBT, psbts are NOT forwarded.
		"proofs": string[], (array) proof that this epoch is valid
	}
  ```



... MORE TO COME

# Security Policy

<p align="center">
  <a href="https://verichains.io">
    <img src="https://raw.githubusercontent.com/btc-vision/contract-logo/refs/heads/main/public-assets/verichains.png" alt="Verichains" width="150"/>
  </a>
</p>

<p align="center">
  <a href="https://verichains.io">
    <img src="https://img.shields.io/badge/Security%20Audit-Verichains-4C35E0?style=for-the-badge" alt="Audited by Verichains"/>
  </a>
</p>

## Audit Status

| Component   | Status       | Auditor                             |
|-------------|--------------|-------------------------------------|
| opnet-node  | Final Review | [Verichains](https://verichains.io) |

## Supported Versions

| Version       | Status        |
|---------------|---------------|
| 1.x.x-alpha   | Supported     |
| < 1.0.0-alpha | Not supported |

## Reporting a Vulnerability

**DO NOT** open a public GitHub issue for security vulnerabilities.

Report vulnerabilities through [GitHub Security Advisories](https://github.com/btc-vision/opnet-node/security/advisories/new).

Include:
- Description of the vulnerability
- Affected version(s)
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

| Action                   | Timeframe   |
|--------------------------|-------------|
| Initial response         | 48 hours    |
| Vulnerability assessment | 7 days      |
| Patch development        | 14-30 days  |
| Public disclosure        | After patch |

## Security Scope

### In Scope

**Consensus Layer**
- Proof of Calculation (PoC) verification
- Proof of Work (PoW) validation
- Epoch state transitions
- Deterministic ordering and execution
- State checkpointing and Merkle roots

**Execution Environment**
- WebAssembly (WASM) VM sandboxing
- Smart contract execution isolation
- Memory safety and resource limits
- Deterministic execution guarantees

**Networking**
- P2P protocol (libp2p)
- RPC authentication and authorization
- API input validation
- Rate limiting and DoS protection

**Cryptography**
- Signature verification (Schnorr, ML-DSA)
- Hash functions (SHA256, SHA1 for PoW)
- Key derivation and management
- Address validation

**Data Integrity**
- Database transaction atomicity
- State consistency across restarts
- Reorg handling

### Out of Scope

- Third-party dependencies (report to respective maintainers)
- User configuration errors
- Issues in development/test environments only
- Bitcoin Core vulnerabilities (report to Bitcoin Core)
- MongoDB vulnerabilities (report to MongoDB)

## Security Best Practices for Node Operators

1. **Network Security**
   - Run the node behind a firewall
   - Use TLS for RPC connections
   - Restrict RPC access to trusted IPs

2. **System Security**
   - Keep the operating system updated
   - Use a dedicated user for running the node
   - Enable disk encryption for state data

3. **Operational Security**
   - Regularly backup the node state
   - Monitor logs for anomalies
   - Keep the node software updated

## Contact

- **Security Issues**: [GitHub Security Advisories](https://github.com/btc-vision/opnet-node/security/advisories)
- **General Issues**: [GitHub Issues](https://github.com/btc-vision/opnet-node/issues)
- **Website**: [opnet.org](https://opnet.org)

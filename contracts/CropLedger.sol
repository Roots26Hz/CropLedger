// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title  CropLedger
 * @notice Tamper-evident, device-attributed evidence ledger for soil nutrient
 *         (N, P, K) readings produced by crop-field edge devices.
 *
 * @dev    Trust model
 *         - The owner (e.g. a cooperative or regulator) registers each device's
 *           signing address, field and firmware hash, and can revoke devices.
 *         - A device signs every reading off-chain with EIP-712 typed data.
 *           Anyone (a "gateway") may relay the signed reading; the contract
 *           accepts it only if the signature recovers to the registered,
 *           active signer of that device.
 *         - Each device has a strictly increasing nonce, so a signed reading
 *           can be recorded at most once (replay protection).
 *         - The EIP-712 domain binds signatures to this contract address and
 *           chain ID, so they cannot be replayed on another deployment.
 *         - Only compact values plus the keccak256 hash of the full off-chain
 *           payload are stored. Anyone can later recompute the hash of a
 *           payload and call {verifyReading} to detect tampering.
 *
 *         The ledger proves the integrity and attribution of what a device
 *         reported. It cannot prove that the physical sensor was accurate.
 */
contract CropLedger is Ownable2Step, EIP712 {
    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------

    /// @notice Reading values signed by the device and submitted by a gateway.
    struct Reading {
        uint64 timestamp; // Unix time (seconds) at which the device sampled
        uint16 n; // Nitrogen, mg/kg
        uint16 p; // Phosphorus, mg/kg
        uint16 k; // Potassium, mg/kg
        bytes32 payloadHash; // keccak256 of the canonical off-chain payload
    }

    /// @notice A reading as stored on-chain (packed into two storage slots).
    struct ReadingRecord {
        uint64 timestamp;
        uint16 n;
        uint16 p;
        uint16 k;
        uint64 nonce; // Device nonce used for this reading
        uint64 blockNumber; // Block in which the reading was recorded
        bytes32 payloadHash;
    }

    /// @notice Registry entry for an edge device.
    struct Device {
        address signer; // Address derived from the device's signing key
        uint64 lastNonce; // Highest nonce accepted so far (0 = none yet)
        bool active; // False once revoked
        uint64 registeredAt; // Block timestamp of registration
        uint64 revokedAt; // Block timestamp of revocation (0 = never)
        bytes32 fieldId; // Field the device is bound to
        bytes32 firmwareHash; // SHA-256 of the approved firmware image
    }

    // ------------------------------------------------------------------
    // Constants
    // ------------------------------------------------------------------

    /// @notice EIP-712 type hash of the signed reading structure.
    bytes32 public constant READING_TYPEHASH = keccak256(
        "Reading(bytes32 deviceId,bytes32 fieldId,uint64 timestamp,uint16 n,uint16 p,uint16 k,uint64 nonce,bytes32 payloadHash)"
    );

    /// @notice Upper sanity bound for any nutrient value (mg/kg).
    uint16 public constant MAX_NUTRIENT_VALUE = 10_000;

    /// @notice How far in the future (relative to the block) a reading timestamp may be.
    uint64 public constant MAX_FUTURE_DRIFT = 15 minutes;

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------

    mapping(bytes32 deviceId => Device) private _devices;
    mapping(bytes32 deviceId => ReadingRecord[]) private _readings;
    bytes32[] private _deviceIds;

    /// @notice Device ID that a signing address is assigned to (zero if none).
    mapping(address signer => bytes32 deviceId) public deviceIdOfSigner;

    /// @notice Total number of readings recorded across all devices.
    uint256 public totalReadings;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    event DeviceRegistered(
        bytes32 indexed deviceId,
        bytes32 indexed fieldId,
        address indexed signer,
        bytes32 firmwareHash
    );

    event DeviceRevoked(bytes32 indexed deviceId, uint64 revokedAt);

    event FirmwareHashUpdated(bytes32 indexed deviceId, bytes32 previousHash, bytes32 newHash);

    event ReadingRecorded(
        bytes32 indexed deviceId,
        bytes32 indexed fieldId,
        uint256 indexed index,
        uint64 nonce,
        uint64 timestamp,
        uint16 n,
        uint16 p,
        uint16 k,
        bytes32 payloadHash,
        address submitter
    );

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------

    error InvalidDeviceId();
    error InvalidSigner();
    error InvalidFieldId();
    error InvalidFirmwareHash();
    error DeviceAlreadyRegistered(bytes32 deviceId);
    error SignerAlreadyAssigned(address signer, bytes32 deviceId);
    error UnknownDevice(bytes32 deviceId);
    error DeviceNotActive(bytes32 deviceId);
    error StaleNonce(bytes32 deviceId, uint64 nonce, uint64 lastNonce);
    error InvalidSignature(bytes32 deviceId);
    error InvalidTimestamp(uint64 timestamp);
    error NutrientValueOutOfRange(uint16 n, uint16 p, uint16 k);
    error InvalidPayloadHash();
    error ReadingIndexOutOfBounds(bytes32 deviceId, uint256 index, uint256 count);
    error DeviceIndexOutOfBounds(uint256 index, uint256 count);

    // ------------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------------

    /// @param initialOwner Account allowed to register and revoke devices.
    constructor(address initialOwner) Ownable(initialOwner) EIP712("CropLedger", "1") {}

    // ------------------------------------------------------------------
    // Device registry (owner only)
    // ------------------------------------------------------------------

    /**
     * @notice Register a new edge device.
     * @dev    A device ID can be registered only once, even after revocation,
     *         so historical evidence can never be re-attributed. A signing
     *         address can likewise belong to only one device.
     */
    function registerDevice(bytes32 deviceId, address signer, bytes32 fieldId, bytes32 firmwareHash)
        external
        onlyOwner
    {
        if (deviceId == bytes32(0)) revert InvalidDeviceId();
        if (signer == address(0)) revert InvalidSigner();
        if (fieldId == bytes32(0)) revert InvalidFieldId();
        if (firmwareHash == bytes32(0)) revert InvalidFirmwareHash();
        if (_devices[deviceId].signer != address(0)) revert DeviceAlreadyRegistered(deviceId);
        bytes32 existing = deviceIdOfSigner[signer];
        if (existing != bytes32(0)) revert SignerAlreadyAssigned(signer, existing);

        _devices[deviceId] = Device({
            signer: signer,
            lastNonce: 0,
            active: true,
            registeredAt: uint64(block.timestamp),
            revokedAt: 0,
            fieldId: fieldId,
            firmwareHash: firmwareHash
        });
        deviceIdOfSigner[signer] = deviceId;
        _deviceIds.push(deviceId);

        emit DeviceRegistered(deviceId, fieldId, signer, firmwareHash);
    }

    /**
     * @notice Permanently revoke a device (e.g. its key was compromised).
     * @dev    Readings recorded before revocation stay retrievable.
     */
    function revokeDevice(bytes32 deviceId) external onlyOwner {
        Device storage device = _requireDevice(deviceId);
        if (!device.active) revert DeviceNotActive(deviceId);

        device.active = false;
        device.revokedAt = uint64(block.timestamp);

        emit DeviceRevoked(deviceId, device.revokedAt);
    }

    /// @notice Record an approved firmware upgrade for an active device.
    function updateFirmwareHash(bytes32 deviceId, bytes32 newFirmwareHash) external onlyOwner {
        Device storage device = _requireDevice(deviceId);
        if (!device.active) revert DeviceNotActive(deviceId);
        if (newFirmwareHash == bytes32(0)) revert InvalidFirmwareHash();

        bytes32 previous = device.firmwareHash;
        device.firmwareHash = newFirmwareHash;

        emit FirmwareHashUpdated(deviceId, previous, newFirmwareHash);
    }

    // ------------------------------------------------------------------
    // Reading submission (any gateway may relay a device-signed reading)
    // ------------------------------------------------------------------

    /**
     * @notice Record a reading signed by a registered device.
     * @param  deviceId  Registered device ID.
     * @param  r         Reading values exactly as signed by the device.
     * @param  nonce     Device nonce; must be greater than the last accepted one.
     * @param  signature 65-byte EIP-712 signature by the device's signing key.
     * @return index     Position of the new reading in the device's history.
     */
    function submitReading(bytes32 deviceId, Reading calldata r, uint64 nonce, bytes calldata signature)
        external
        returns (uint256 index)
    {
        Device storage device = _requireDevice(deviceId);
        if (!device.active) revert DeviceNotActive(deviceId);
        if (nonce <= device.lastNonce) revert StaleNonce(deviceId, nonce, device.lastNonce);
        _validateReading(r);

        bytes32 digest = readingDigest(deviceId, device.fieldId, r, nonce);
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || recovered != device.signer) {
            revert InvalidSignature(deviceId);
        }

        device.lastNonce = nonce;
        index = _store(
            deviceId,
            device.fieldId,
            ReadingRecord({
                timestamp: r.timestamp,
                n: r.n,
                p: r.p,
                k: r.k,
                nonce: nonce,
                blockNumber: uint64(block.number),
                payloadHash: r.payloadHash
            })
        );
    }

    // ------------------------------------------------------------------
    // Evidence queries
    // ------------------------------------------------------------------

    /// @notice Number of readings recorded for a device (0 for unknown devices).
    function getReadingCount(bytes32 deviceId) external view returns (uint256) {
        return _readings[deviceId].length;
    }

    /// @notice Return one stored reading of a device.
    function getReading(bytes32 deviceId, uint256 index) external view returns (ReadingRecord memory) {
        return _readingAt(deviceId, index);
    }

    /**
     * @notice Check whether a payload hash matches the stored reading.
     * @dev    Callers recompute keccak256 over the canonical payload they hold.
     *         Any modification to that payload changes the hash and yields false.
     */
    function verifyReading(bytes32 deviceId, uint256 index, bytes32 payloadHash) external view returns (bool) {
        return _readingAt(deviceId, index).payloadHash == payloadHash;
    }

    /// @notice Return the registry entry of a device.
    function getDevice(bytes32 deviceId) external view returns (Device memory) {
        return _requireDevice(deviceId);
    }

    /// @notice True if the device is registered and not revoked.
    function isDeviceActive(bytes32 deviceId) external view returns (bool) {
        return _devices[deviceId].active;
    }

    /// @notice Number of devices ever registered.
    function getDeviceCount() external view returns (uint256) {
        return _deviceIds.length;
    }

    /// @notice Device ID at a position of the registration list (for enumeration).
    function deviceIdAt(uint256 index) external view returns (bytes32) {
        if (index >= _deviceIds.length) revert DeviceIndexOutOfBounds(index, _deviceIds.length);
        return _deviceIds[index];
    }

    /**
     * @notice EIP-712 digest a device must sign for a reading.
     * @dev    Exposed so off-chain signers can cross-check their encoding.
     */
    function readingDigest(bytes32 deviceId, bytes32 fieldId, Reading calldata r, uint64 nonce)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(READING_TYPEHASH, deviceId, fieldId, r.timestamp, r.n, r.p, r.k, nonce, r.payloadHash)
            )
        );
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    function _requireDevice(bytes32 deviceId) private view returns (Device storage device) {
        device = _devices[deviceId];
        if (device.signer == address(0)) revert UnknownDevice(deviceId);
    }

    /// @dev Separate function keeps submitReading below the EVM stack limit
    ///      without requiring the via-IR pipeline (simpler Remix settings).
    function _store(bytes32 deviceId, bytes32 fieldId, ReadingRecord memory rec) private returns (uint256 index) {
        ReadingRecord[] storage history = _readings[deviceId];
        index = history.length;
        history.push(rec);
        unchecked {
            ++totalReadings;
        }
        emit ReadingRecorded(
            deviceId, fieldId, index, rec.nonce, rec.timestamp, rec.n, rec.p, rec.k, rec.payloadHash, msg.sender
        );
    }

    function _readingAt(bytes32 deviceId, uint256 index) private view returns (ReadingRecord storage) {
        ReadingRecord[] storage history = _readings[deviceId];
        if (index >= history.length) revert ReadingIndexOutOfBounds(deviceId, index, history.length);
        return history[index];
    }

    function _validateReading(Reading calldata r) private view {
        if (r.timestamp == 0 || r.timestamp > block.timestamp + MAX_FUTURE_DRIFT) {
            revert InvalidTimestamp(r.timestamp);
        }
        if (r.n > MAX_NUTRIENT_VALUE || r.p > MAX_NUTRIENT_VALUE || r.k > MAX_NUTRIENT_VALUE) {
            revert NutrientValueOutOfRange(r.n, r.p, r.k);
        }
        if (r.payloadHash == bytes32(0)) revert InvalidPayloadHash();
    }
}

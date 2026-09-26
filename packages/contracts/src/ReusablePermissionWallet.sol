// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEIP3009Domain {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

interface IERC20Transfer {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Persistent wallet with disposable, independently-scoped agent permissions.
/// Token permissions pay x402 (EIP-3009) authorizations: the agent approves an exact
/// authorization on-chain and the token accepts it through ERC-1271.
contract ReusablePermissionWallet {
    error NotOwner();
    error NotAgent();
    error PermissionNotFound();
    error PermissionIsRevoked();
    error PermissionExpired();
    error PermissionExhausted();
    error InvalidTarget();
    error SpendLimitExceeded();
    error TransferFailed();
    error CallFailed(bytes data);
    error NotTokenPermission();
    error NotNativePermission();
    error AuthorizationOutlivesPermission();
    error NonceAlreadyApproved();

    struct Permission {
        address agent;
        address allowedTarget;
        uint256 maxSpend;
        uint256 spent;
        uint64 expiresAt;
        uint32 maxUses;
        uint32 uses;
        bool revoked;
        address asset;
    }

    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes4 internal constant ERC1271_MAGIC = 0x1626ba7e;

    address public owner;
    uint256 public nextPermissionId;
    mapping(uint256 => Permission) public permissions;
    mapping(bytes32 => bool) public approvedDigest;
    /// @notice EIP-3009 nonce => permissionId + 1 (0 = not approved).
    mapping(bytes32 => uint256) public approvedNonce;

    event PermissionCreated(
        uint256 indexed permissionId,
        address indexed agent,
        address indexed allowedTarget,
        uint256 maxSpend,
        uint64 expiresAt,
        uint32 maxUses
    );
    event PermissionUsed(uint256 indexed permissionId, uint32 uses, uint256 spent);
    event PermissionRevoked(uint256 indexed permissionId);
    event Executed(uint256 indexed permissionId, address indexed agent, address indexed target, uint256 value, bytes data);
    event Withdrawn(address indexed owner, uint256 amount);
    event PaymentApproved(uint256 indexed permissionId, address indexed payTo, uint256 amount, bytes32 nonce, bytes32 digest);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address owner_) payable {
        require(owner_ != address(0), "owner=0");
        owner = owner_;
    }

    receive() external payable {}

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param allowedTarget For native permissions: the only callable target. For token
    /// permissions: the only payee, or address(0) for any (screened) payee.
    /// @param asset address(0) for native ETH, otherwise an EIP-3009 token such as USDC.
    function createPermission(
        address agent,
        address allowedTarget,
        uint256 maxSpend,
        uint64 expiresAt,
        uint32 maxUses,
        address asset
    ) external onlyOwner returns (uint256 permissionId) {
        require(agent != address(0), "agent=0");
        require(allowedTarget != address(0) || asset != address(0), "target=0");
        require(expiresAt > block.timestamp, "expired");
        require(maxUses > 0, "uses=0");

        permissionId = nextPermissionId++;
        permissions[permissionId] = Permission({
            agent: agent,
            allowedTarget: allowedTarget,
            maxSpend: maxSpend,
            spent: 0,
            expiresAt: expiresAt,
            maxUses: maxUses,
            uses: 0,
            revoked: false,
            asset: asset
        });

        emit PermissionCreated(permissionId, agent, allowedTarget, maxSpend, expiresAt, maxUses);
    }

    function execute(uint256 permissionId, address target, uint256 value, bytes calldata data)
        external
        returns (bytes memory result)
    {
        Permission storage permission = _consume(permissionId, value);
        if (permission.asset != address(0)) revert NotNativePermission();
        if (target != permission.allowedTarget) revert InvalidTarget();

        (bool ok, bytes memory returnData) = target.call{value: value}(data);
        if (!ok) revert CallFailed(returnData);

        emit Executed(permissionId, msg.sender, target, value, data);
        return returnData;
    }

    /// @notice Approves one exact EIP-3009 TransferWithAuthorization from this wallet.
    /// Budget and uses are consumed here, before any signature exists.
    function approvePayment(
        uint256 permissionId,
        address payTo,
        uint256 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) external returns (bytes32 digest) {
        Permission storage permission = _consume(permissionId, amount);
        if (permission.asset == address(0)) revert NotTokenPermission();
        if (permission.allowedTarget != address(0) && payTo != permission.allowedTarget) revert InvalidTarget();
        if (validBefore > permission.expiresAt) revert AuthorizationOutlivesPermission();
        if (approvedNonce[nonce] != 0) revert NonceAlreadyApproved();

        digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                IEIP3009Domain(permission.asset).DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        TRANSFER_WITH_AUTHORIZATION_TYPEHASH, address(this), payTo, amount, validAfter, validBefore, nonce
                    )
                )
            )
        );
        approvedDigest[digest] = true;
        approvedNonce[nonce] = permissionId + 1;

        emit PaymentApproved(permissionId, payTo, amount, nonce, digest);
    }

    /// @notice ERC-1271: only digests approved through approvePayment are valid.
    /// The signature bytes are not trusted; callers pass > 65 bytes so x402 facilitators
    /// route to the contract-signer path.
    function isValidSignature(bytes32 hash, bytes calldata) external view returns (bytes4) {
        return approvedDigest[hash] ? ERC1271_MAGIC : bytes4(0xffffffff);
    }

    function revokePermission(uint256 permissionId) external onlyOwner {
        if (permissionId >= nextPermissionId) revert PermissionNotFound();
        permissions[permissionId].revoked = true;
        emit PermissionRevoked(permissionId);
    }

    function withdraw(uint256 amount) external onlyOwner {
        (bool ok,) = owner.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(owner, amount);
    }

    function withdrawToken(address asset, uint256 amount) external onlyOwner {
        if (!IERC20Transfer(asset).transfer(owner, amount)) revert TransferFailed();
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "owner=0");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @dev Shared checks for execute and approvePayment; consumes one use and `value` budget.
    function _consume(uint256 permissionId, uint256 value) internal returns (Permission storage permission) {
        if (permissionId >= nextPermissionId) revert PermissionNotFound();
        permission = permissions[permissionId];

        if (msg.sender != permission.agent) revert NotAgent();
        if (permission.revoked) revert PermissionIsRevoked();
        if (block.timestamp > permission.expiresAt) revert PermissionExpired();
        if (permission.uses >= permission.maxUses) revert PermissionExhausted();
        if (permission.spent + value > permission.maxSpend) revert SpendLimitExceeded();

        // Consume allowance before any external call. A revert rolls these changes back.
        permission.uses += 1;
        permission.spent += value;
        emit PermissionUsed(permissionId, permission.uses, permission.spent);
    }
}

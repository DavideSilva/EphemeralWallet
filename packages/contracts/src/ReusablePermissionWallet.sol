// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Persistent wallet with disposable, independently-scoped agent permissions.
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

    struct Permission {
        address agent;
        address allowedTarget;
        uint256 maxSpend;
        uint256 spent;
        uint64 expiresAt;
        uint32 maxUses;
        uint32 uses;
        bool revoked;
    }

    address public immutable owner;
    uint256 public nextPermissionId;
    mapping(uint256 => Permission) public permissions;

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
    event Executed(
        uint256 indexed permissionId, address indexed agent, address indexed target, uint256 value, bytes data, string memo
    );
    event Withdrawn(address indexed owner, uint256 amount);

    constructor(address owner_) payable {
        require(owner_ != address(0), "owner=0");
        owner = owner_;
    }

    receive() external payable {}

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function createPermission(
        address agent,
        address allowedTarget,
        uint256 maxSpend,
        uint64 expiresAt,
        uint32 maxUses
    ) external onlyOwner returns (uint256 permissionId) {
        require(agent != address(0), "agent=0");
        require(allowedTarget != address(0), "target=0");
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
            revoked: false
        });

        emit PermissionCreated(permissionId, agent, allowedTarget, maxSpend, expiresAt, maxUses);
    }

    function execute(
        uint256 permissionId,
        address target,
        uint256 value,
        bytes calldata data,
        string calldata memo
    ) external
        returns (bytes memory result)
    {
        if (permissionId >= nextPermissionId) revert PermissionNotFound();
        Permission storage permission = permissions[permissionId];

        if (msg.sender != permission.agent) revert NotAgent();
        if (permission.revoked) revert PermissionIsRevoked();
        if (block.timestamp > permission.expiresAt) revert PermissionExpired();
        if (permission.uses >= permission.maxUses) revert PermissionExhausted();
        if (target != permission.allowedTarget) revert InvalidTarget();
        if (permission.spent + value > permission.maxSpend) revert SpendLimitExceeded();

        // Consume allowance before the external call. A revert rolls these changes back.
        permission.uses += 1;
        permission.spent += value;

        (bool ok, bytes memory returnData) = target.call{value: value}(data);
        if (!ok) revert CallFailed(returnData);

        emit PermissionUsed(permissionId, permission.uses, permission.spent);
        emit Executed(permissionId, msg.sender, target, value, data, memo);
        return returnData;
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
}

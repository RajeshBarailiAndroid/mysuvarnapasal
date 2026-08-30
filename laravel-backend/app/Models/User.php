<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    /** Account moderation states. */
    public const STATUS_PENDING = 'pending';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_DENIED = 'denied';
    public const STATUS_DEACTIVATED = 'deactivated';

    /** How long one approval lasts. Extending adds another of these. */
    public const SUBSCRIPTION_YEARS = 1;

    protected $fillable = [
        'name',
        'username',
        'email',
        'phone',
        'password',
        'status',
        'is_admin',
        'approved_at',
        'approved_by',
        'expires_at',
        'read_only',
        'must_change_password',
        'status_changed_at',
        'status_reason',
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_admin' => 'boolean',
            'read_only' => 'boolean',
            'must_change_password' => 'boolean',
            'approved_at' => 'datetime',
            'expires_at' => 'datetime',
            'status_changed_at' => 'datetime',
        ];
    }

    // ── Account state ────────────────────────────────────────────────────

    public function isApproved(): bool
    {
        return $this->status === self::STATUS_APPROVED;
    }

    /**
     * A subscription that has run out. NULL expires_at means "no expiry set"
     * and is never treated as expired — that is what every account created
     * before subscriptions existed looks like.
     */
    public function isExpired(): bool
    {
        return $this->expires_at !== null && $this->expires_at->isPast();
    }

    /** Null when no expiry is set; 0 once it has lapsed. */
    public function remainingDays(): ?int
    {
        if ($this->expires_at === null) return null;
        return max(0, (int) now()->startOfDay()->diffInDays($this->expires_at->startOfDay(), false));
    }

    /**
     * The one gate that decides whether this account may use the API at all.
     * The admin is exempt from expiry — locking the moderator out of their own
     * console because a subscription lapsed would be unrecoverable.
     */
    public function canUseApi(): bool
    {
        if ($this->is_admin) return $this->status !== self::STATUS_DENIED;
        return $this->isApproved() && !$this->isExpired();
    }

    /** Why the API is refusing them, in words a shop owner can act on. */
    public function accessMessage(): string
    {
        if ($this->isExpired() && $this->isApproved()) {
            return 'Your subscription has expired. Contact the administrator to renew it.';
        }
        return match ($this->status) {
            self::STATUS_PENDING => 'Your shop is waiting for administrator approval.',
            self::STATUS_DENIED => 'This account was not approved. Contact the administrator.',
            self::STATUS_DEACTIVATED => 'This account has been deactivated. Contact the administrator.',
            default => 'This account cannot sign in right now.',
        };
    }

    /**
     * The Account shape the Android app already deserializes
     * (data/ApiModels.kt). Field names here are load-bearing — the mobile
     * admin screen breaks if they drift.
     */
    public function toAccountArray(): array
    {
        return [
            'id' => (string) $this->id,
            'username' => (string) $this->username,
            'displayName' => (string) $this->name,
            'email' => $this->email,
            'phone' => $this->phone,
            'status' => (string) $this->status,
            'isAdmin' => (bool) $this->is_admin,
            'approvedAt' => optional($this->approved_at)->toIso8601String(),
            'approvedBy' => $this->approved_by,
            'expiresAt' => optional($this->expires_at)->toIso8601String(),
            'remainingDays' => $this->remainingDays(),
            'createdAt' => optional($this->created_at)->toIso8601String(),
            'readOnly' => (bool) $this->read_only,
        ];
    }
}

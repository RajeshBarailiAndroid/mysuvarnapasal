<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Shop-account moderation: status, the single admin flag, and subscription
 * expiry — plus a hashed, single-use password-reset table.
 *
 * Purely additive. No existing column is altered or dropped, so every current
 * feature (sync, licences, the desktop app, the public request link) keeps
 * working untouched.
 *
 * IMPORTANT: the `status` column defaults to 'pending' for NEW signups, but
 * every account that already exists is back-filled to 'approved'. Shipping
 * this without the back-fill would lock every existing shop out of their own
 * data the moment it ran.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // pending | approved | denied | deactivated
            $table->string('status', 24)->default('pending')->index();
            $table->boolean('is_admin')->default(false);
            $table->timestamp('approved_at')->nullable();
            $table->string('approved_by', 64)->nullable();
            // NULL = no expiry. Set to approved_at + subscription years.
            $table->timestamp('expires_at')->nullable();
            // Read-only shops can still see their data but cannot write.
            $table->boolean('read_only')->default(false);
            // Forces the bootstrapped admin to rotate its one-time password.
            $table->boolean('must_change_password')->default(false);
            $table->timestamp('status_changed_at')->nullable();
            $table->string('status_reason', 500)->nullable();
        });

        // Grandfather every existing shop: they were using the app before
        // approval existed, so they are approved, with no expiry.
        DB::table('users')->update([
            'status' => 'approved',
            'approved_at' => now(),
            'approved_by' => 'migration',
            'status_changed_at' => now(),
        ]);

        // Single-use password reset tokens.
        //
        // Only sha256(token) is stored, so a database dump yields no working
        // reset links. This is a separate table from Laravel's stock
        // `password_reset_tokens` (which is left alone) because that one is
        // keyed by email alone and cannot express single use or expiry.
        Schema::create('auth_password_resets', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->index();
            $table->string('email')->index();
            $table->char('token_hash', 64)->unique();
            $table->timestamp('expires_at');
            $table->timestamp('used_at')->nullable();
            $table->timestamp('invalidated_at')->nullable();
            $table->string('requested_ip', 45)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('auth_password_resets');

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn([
                'status', 'is_admin', 'approved_at', 'approved_by', 'expires_at',
                'read_only', 'must_change_password', 'status_changed_at', 'status_reason',
            ]);
        });
    }
};

<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * The ONLY way an administrator account comes into existence.
 *
 *   php artisan pos:create-admin --username=admin --email=you@shop.com
 *   php artisan pos:create-admin --promote=existinguser
 *   php artisan pos:create-admin --username=admin --reset-password
 *
 * There is no "make me admin" API endpoint and signup cannot set a role, so
 * an operator with shell access is the only path to admin. The generated
 * password is printed once and never stored anywhere else; the account is
 * flagged `must_change_password`, which EnsureAdmin blocks on until rotated.
 */
class CreateAdmin extends Command
{
    protected $signature = 'pos:create-admin
                            {--username= : Username for the new admin account}
                            {--email= : Contact email for the admin}
                            {--name= : Display name (defaults to "Administrator")}
                            {--promote= : Promote an existing username instead of creating one}
                            {--reset-password : Rotate the existing admin password}';

    protected $description = 'Create (or rotate) the single administrator account';

    public function handle(): int
    {
        $existing = User::where('is_admin', true)->first();

        if ($this->option('reset-password')) {
            if (!$existing) {
                $this->error('No administrator exists yet. Run without --reset-password first.');
                return self::FAILURE;
            }
            $password = $this->randomPassword();
            $existing->password = $password;
            $existing->must_change_password = true;
            $existing->save();
            $existing->tokens()->delete();       // kill every live admin session
            $this->report($existing, $password, 'rotated');
            return self::SUCCESS;
        }

        if ($existing) {
            $this->error("An administrator already exists: {$existing->username}");
            $this->line('Use --reset-password to rotate its password, or demote that account first:');
            $this->line("  php artisan tinker --execute=\"App\\Models\\User::where('username','{$existing->username}')->update(['is_admin'=>false]);\"");
            return self::FAILURE;
        }

        // ── Promote an existing shop account ─────────────────────────────
        if ($promote = $this->option('promote')) {
            $user = User::where('username', strtolower(trim($promote)))->first();
            if (!$user) {
                $this->error("No account with username \"{$promote}\".");
                return self::FAILURE;
            }
            $user->is_admin = true;
            $user->status = User::STATUS_APPROVED;
            $user->read_only = false;
            $user->approved_at = $user->approved_at ?? now();
            $user->approved_by = 'console';
            $user->save();

            $this->info("\"{$user->username}\" is now the administrator. Their existing password is unchanged.");
            return self::SUCCESS;
        }

        // ── Create a fresh admin ─────────────────────────────────────────
        $username = strtolower(trim((string) ($this->option('username') ?: $this->ask('Admin username', 'admin'))));
        if (!preg_match('/^[a-z0-9_]{3,24}$/', $username)) {
            $this->error('Username must be 3–24 characters: lowercase letters, numbers, underscore.');
            return self::FAILURE;
        }
        if (User::where('username', $username)->exists()) {
            $this->error("Username \"{$username}\" is already taken. Use --promote={$username} to make that account the admin.");
            return self::FAILURE;
        }

        $email = trim((string) ($this->option('email') ?: $this->ask('Admin email (for password resets)')));
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->error('That is not a valid email address.');
            return self::FAILURE;
        }

        $password = $this->randomPassword();

        $user = DB::transaction(fn () => User::create([
            'name' => (string) ($this->option('name') ?: 'Administrator'),
            'username' => $username,
            'email' => $email !== '' ? strtolower($email) : null,
            'password' => $password,
            'is_admin' => true,
            'status' => User::STATUS_APPROVED,
            'approved_at' => now(),
            'approved_by' => 'console',
            'status_changed_at' => now(),
            'must_change_password' => true,
            'email_verified_at' => now(),
        ]));

        $this->report($user, $password, 'created');
        return self::SUCCESS;
    }

    /** ~186 bits of entropy, URL-safe so it survives copy/paste. */
    private function randomPassword(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
    }

    private function report(User $user, string $password, string $verb): void
    {
        $rule = str_repeat('=', 64);
        $this->newLine();
        $this->line($rule);
        $this->line('  ADMINISTRATOR ' . strtoupper($verb));
        $this->line($rule);
        $this->line('  username: ' . $user->username);
        $this->line('  email:    ' . ($user->email ?: '(none)'));
        $this->line('  password: ' . $password);
        $this->line($rule);
        $this->warn('  This password is shown once and is stored nowhere else.');
        $this->warn('  It must be changed on first sign-in before the admin');
        $this->warn('  console will open. Save it now, then clear your');
        $this->warn('  terminal scrollback.');
        $this->newLine();
    }
}

<?php

namespace Tests;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;

/**
 * Base class for the SubarnaPasal API feature tests.
 *
 * Every test runs against the throwaway in-memory SQLite database declared in
 * phpunit.xml, so nothing here can reach — let alone modify — a real shop's
 * data. RefreshDatabase re-migrates between tests, which keeps them order
 * independent.
 */
abstract class ApiTestCase extends TestCase
{
    use RefreshDatabase;

    /** Default signup payload; override any field per test. */
    protected function signupPayload(array $overrides = []): array
    {
        return array_merge([
            'username' => 'goldshop',
            'full_name' => 'Ram Bahadur',
            'email' => 'ram@example.com',
            'password' => 'secret123',
        ], $overrides);
    }

    /** POST /api/auth/signup and return the raw response. */
    protected function signup(array $overrides = []): TestResponse
    {
        return $this->postJson('/api/auth/signup', $this->signupPayload($overrides));
    }

    /**
     * Sign a fresh shop up, approve it, and return its bearer token.
     *
     * Signup alone no longer yields a session: accounts are created `pending`
     * and an administrator has to approve them, so tests that need a working
     * token approve the account directly before logging in.
     */
    protected function signupToken(array $overrides = []): string
    {
        $payload = $this->signupPayload($overrides);
        $this->postJson('/api/auth/signup', $payload)->assertCreated();

        $user = \App\Models\User::where('username', $payload['username'])->firstOrFail();
        $user->grantSubscription('test');

        $response = $this->postJson('/api/auth/login', [
            'username' => $payload['username'],
            'password' => $payload['password'],
        ]);
        $response->assertOk();

        return $response->json('session.access_token');
    }

    /** Promote an account to administrator (and approve it). */
    protected function makeAdmin(string $username): \App\Models\User
    {
        $user = \App\Models\User::where('username', $username)->firstOrFail();
        $user->is_admin = true;
        $user->grantSubscription('test');
        return $user->fresh();
    }

    /** Authorization header array for an already-issued token. */
    protected function bearer(string $token): array
    {
        return ['Authorization' => 'Bearer ' . $token];
    }

    /**
     * Create one inventory item for the given shop and return the decoded item.
     * Uses gold so it needs no custom rate-per-tola.
     */
    protected function createItem(string $token, array $overrides = []): array
    {
        $payload = array_merge([
            'sku' => 'SKU-001',
            'name' => 'Gold Chain',
            'category' => 'gold',
            'karat' => 22,
            'weightGrams' => 11.664,
            'makingCharge' => 1500,
            'salePrice' => 120000,
            'quantity' => 3,
            'status' => 'in_stock',
        ], $overrides);

        $response = $this->withHeaders($this->bearer($token))
            ->postJson('/api/items', $payload);
        $response->assertCreated();

        return $response->json();
    }
}

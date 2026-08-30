<?php

use App\Http\Controllers\Api\AdminController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\ItemController;
use App\Http\Controllers\Api\KarigarController;
use App\Http\Controllers\Api\LicenseController;
use App\Http\Controllers\Api\OldGoldController;
use App\Http\Controllers\Api\OptionController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\PublicRequestController;
use App\Http\Controllers\Api\RatesController;
use App\Http\Controllers\Api\RepairController;
use App\Http\Controllers\Api\RequestController;
use App\Http\Controllers\Api\SaleController;
use App\Http\Controllers\Api\SchemeController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\SyncController;
use App\Http\Controllers\Api\TransactionController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| API routes — same paths as the original Express backend (/api/...)
|--------------------------------------------------------------------------
*/

// ── Public routes (no auth) ──────────────────────────────────────────────
Route::get('/health', [DashboardController::class, 'health']);
Route::get('/healthz', fn () => response()->json(['ok' => true]));

Route::prefix('auth')->group(function () {
    Route::get('/config', [AuthController::class, 'config']);
    Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1');
    Route::post('/signup', [AuthController::class, 'signup'])->middleware('throttle:10,1');
    Route::post('/forgot-password', [AuthController::class, 'forgotPassword'])->middleware('throttle:5,1');
    Route::get('/me', [AuthController::class, 'me']);
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::post('/change-password', [AuthController::class, 'changePassword'])->middleware('throttle:10,1');
});

// ── Sync (local-first auto backup) ───────────────────────────────────────
Route::post('/sync/push', [SyncController::class, 'push'])->middleware('throttle:240,1');
Route::get('/sync/pull', [SyncController::class, 'pull'])->middleware('throttle:60,1');
Route::get('/sync/run', [SyncController::class, 'run']);
Route::get('/sync/status', [SyncController::class, 'status']);
Route::post('/sync/restore', [SyncController::class, 'restore']);

// ── Desktop app licensing (server role) ──────────────────────────────────
Route::post('/license/signup', [LicenseController::class, 'signup'])->middleware('throttle:5,1');
Route::post('/license/activate', [LicenseController::class, 'activate'])->middleware('throttle:10,1');
Route::post('/license/check', [LicenseController::class, 'check'])->middleware('throttle:60,1');
Route::post('/license/issue', [LicenseController::class, 'issue'])->middleware('throttle:30,1');
Route::get('/license/list', [LicenseController::class, 'list'])->middleware('throttle:60,1');
Route::post('/license/revoke', [LicenseController::class, 'revoke'])->middleware('throttle:30,1');
Route::post('/license/unrevoke', [LicenseController::class, 'unrevoke'])->middleware('throttle:30,1');
Route::post('/license/reveal', [LicenseController::class, 'reveal'])->middleware('throttle:20,1');

// ── Public customer request link (no login) ──────────────────────────────
// One unguessable per-shop code (see PublicRequestController) unlocks exactly
// three things: read-only in-stock inventory, the caller's own requests, and
// filing a new request. Everything else still needs a signed-in shop token.
Route::prefix('public/{code}')->group(function () {
    Route::get('/items', [PublicRequestController::class, 'items'])->middleware('throttle:120,1');
    Route::get('/requests', [PublicRequestController::class, 'mine'])->middleware('throttle:60,1');
    Route::post('/requests', [PublicRequestController::class, 'store_'])->middleware('throttle:20,1');
});

Route::get('/metal-rates', [RatesController::class, 'metalRates']);
Route::get('/shared/gold-rates', [RatesController::class, 'sharedGoldRates']);
Route::get('/cron/capture-gold-rate', [RatesController::class, 'cronCapture']);

// ── Administrator routes ─────────────────────────────────────────────────
// Approve, renew, suspend and block shop accounts. `admin.only` runs after
// `attach.user`, so a signed-in non-admin gets 403 rather than 401.
Route::middleware(['attach.user', 'admin.only'])->prefix('admin')->group(function () {
    Route::get('/users', [AdminController::class, 'users']);
    Route::post('/users/{id}/approve', [AdminController::class, 'approve']);
    Route::post('/users/{id}/extend', [AdminController::class, 'extend']);
    Route::post('/users/{id}/unapprove', [AdminController::class, 'unapprove']);
    Route::post('/users/{id}/deny', [AdminController::class, 'deny']);
});

// ── Authenticated routes ─────────────────────────────────────────────────
Route::middleware('attach.user')->group(function () {
    // SECURITY: writes to the SHARED, cross-shop gold-rate feed. This used to
    // be public, so anyone on the internet could push fake prices into the
    // table that drives POS pricing in api price mode. In no-login mode
    // (AUTH_ENABLED=false) attach.user still passes through as 'local-dev',
    // so desktop behaviour is unchanged.
    Route::post('/shared/gold-rates/ticks', [RatesController::class, 'appendTicks']);

    Route::get('/reports', [DashboardController::class, 'reports']);
    Route::get('/dashboard', [DashboardController::class, 'show']);

    Route::get('/settings', [SettingsController::class, 'show']);
    Route::patch('/settings', [SettingsController::class, 'update']);
    Route::post('/settings/daily-gold-rate', [SettingsController::class, 'dailyGoldRate']);
    Route::delete('/settings/rate-history', [SettingsController::class, 'clearRateHistory']);
    Route::get('/settings/shop-name-available', [SettingsController::class, 'shopNameAvailable']);

    Route::get('/items', [ItemController::class, 'index']);
    Route::post('/items', [ItemController::class, 'store_']);
    Route::get('/items/{id}', [ItemController::class, 'show']);
    Route::put('/items/{id}', [ItemController::class, 'update']);
    Route::delete('/items/{id}', [ItemController::class, 'destroy']);

    Route::get('/customers', [CustomerController::class, 'index']);
    Route::post('/customers', [CustomerController::class, 'store_']);
    Route::post('/customers/upsert', [CustomerController::class, 'upsert']);
    Route::delete('/customers/{id}', [CustomerController::class, 'destroy']);

    Route::get('/transactions', [TransactionController::class, 'index']);
    Route::post('/transactions', [TransactionController::class, 'store_']);

    Route::get('/orders', [OrderController::class, 'index']);
    Route::post('/orders', [OrderController::class, 'store_']);
    Route::get('/orders/{id}', [OrderController::class, 'show']);
    Route::patch('/orders/{id}', [OrderController::class, 'update']);
    Route::delete('/orders/{id}', [OrderController::class, 'destroy']);

    Route::get('/karigar', [KarigarController::class, 'index']);
    Route::post('/karigar', [KarigarController::class, 'store_']);
    Route::put('/karigar/{id}', [KarigarController::class, 'update']);
    Route::delete('/karigar/{id}', [KarigarController::class, 'destroy']);
    Route::post('/karigar/{id}/issue-gold', [KarigarController::class, 'issueGold']);
    Route::post('/karigar/{id}/return-gold', [KarigarController::class, 'returnGold']);
    Route::get('/gold-ledger', [KarigarController::class, 'goldLedger']);

    Route::get('/old-gold', [OldGoldController::class, 'index']);
    Route::post('/old-gold', [OldGoldController::class, 'store_']);
    Route::delete('/old-gold/{id}', [OldGoldController::class, 'destroy']);

    Route::get('/sales', [SaleController::class, 'index']);
    Route::post('/sales', [SaleController::class, 'store_']);
    Route::post('/sales/manual-due', [SaleController::class, 'manualDue']);
    Route::get('/sales/{id}', [SaleController::class, 'show']);
    Route::post('/sales/{id}/payments', [SaleController::class, 'addPayment']);
    Route::post('/sales/{id}/void', [SaleController::class, 'void']);

    Route::get('/repairs', [RepairController::class, 'index']);
    Route::post('/repairs', [RepairController::class, 'store_']);
    Route::patch('/repairs/{id}', [RepairController::class, 'update']);
    Route::delete('/repairs/{id}', [RepairController::class, 'destroy']);

    // The shareable customer link for the signed-in shop.
    Route::get('/public-link', [PublicRequestController::class, 'link']);

    Route::get('/requests', [RequestController::class, 'index']);
    Route::post('/requests', [RequestController::class, 'store_']);
    Route::patch('/requests/{id}', [RequestController::class, 'update']);
    Route::delete('/requests/{id}', [RequestController::class, 'destroy']);

    Route::get('/schemes', [SchemeController::class, 'index']);
    Route::post('/schemes', [SchemeController::class, 'store_']);
    Route::post('/schemes/{id}/installments', [SchemeController::class, 'addInstallment']);
    Route::patch('/schemes/{id}', [SchemeController::class, 'update']);

    Route::get('/options', [OptionController::class, 'index']);
    Route::post('/options', [OptionController::class, 'store_']);
    Route::put('/options/{id}', [OptionController::class, 'update']);
    Route::delete('/options/{id}', [OptionController::class, 'destroy']);
    Route::post('/options/{id}/payments', [OptionController::class, 'addPayment']);
    Route::put('/options/{id}/payments/{paymentId}', [OptionController::class, 'updatePayment']);
    Route::delete('/options/{id}/payments/{paymentId}', [OptionController::class, 'deletePayment']);
});

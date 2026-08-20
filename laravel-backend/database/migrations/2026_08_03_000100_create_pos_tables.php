<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('settings', function (Blueprint $table) {
            $table->string('user_id', 64)->primary();
            $table->string('shop_name')->default('SubarnaPasal');
            $table->string('shop_address')->default('');
            $table->string('shop_phone', 64)->default('');
            $table->string('shop_pan', 64)->default('');
            $table->double('vat_rate')->default(13);
            $table->string('calendar_mode', 16)->default('both');
            $table->string('price_mode', 16)->default('manual');
            $table->double('gold_rate_per_tola')->default(0);
            $table->double('gold_rate_per_gram')->default(0);
            $table->double('gold_buy_rate_per_tola')->default(0);
            $table->double('gold_buy_rate_per_gram')->default(0);
            $table->double('silver_rate_per_tola')->default(0);
            $table->double('silver_rate_per_gram')->default(0);
            $table->string('currency', 8)->default('NPR');
            $table->json('locations')->nullable();
            $table->json('item_categories')->nullable();
            $table->json('rate_history')->nullable();
            $table->json('extras')->nullable();
            $table->string('updated_at', 40)->nullable();
        });

        Schema::create('items', function (Blueprint $table) {
            $table->string('user_id', 64);
            $table->string('id', 64);
            $table->string('sku');
            $table->string('name');
            $table->string('category', 64)->default('gold');
            $table->double('karat')->default(24);
            $table->double('weight_grams')->default(0);
            $table->double('making_charge')->default(0);
            $table->string('jarti_rate_type', 24)->default('flat');
            $table->double('jarti_rate_value')->default(0);
            $table->string('hallmark_number')->default('');
            $table->string('hallmark_date', 40)->default('');
            $table->double('purchase_cost')->default(0);
            $table->double('sale_price')->default(0);
            $table->double('custom_rate_per_tola')->default(0);
            $table->integer('quantity')->default(0);
            $table->string('status', 24)->default('in_stock');
            $table->string('location')->default('');
            $table->boolean('hallmark')->default(false);
            $table->text('notes')->nullable();
            $table->string('hs_code', 64)->default('');
            $table->double('stone_amount')->default(0);
            $table->string('created_at', 40)->nullable();
            $table->string('updated_at', 40)->nullable();
            $table->bigInteger('position')->default(0);
            $table->primary(['user_id', 'id']);
        });

        Schema::create('transactions', function (Blueprint $table) {
            $table->string('user_id', 64);
            $table->string('id', 64);
            $table->string('type', 32);
            $table->string('item_id', 64)->nullable();
            $table->string('item_name')->nullable();
            $table->double('quantity')->default(0);
            $table->double('amount')->nullable();
            $table->text('note')->nullable();
            $table->string('created_at', 40)->nullable();
            $table->bigInteger('position')->default(0);
            $table->primary(['user_id', 'id']);
        });

        Schema::create('orders', function (Blueprint $table) {
            $table->string('user_id', 64);
            $table->string('id', 64);
            $table->string('order_number', 64);
            $table->string('customer_name');
            $table->string('customer_phone', 64)->default('');
            $table->string('status', 24)->default('pending');
            $table->json('lines')->nullable();
            $table->double('total_amount')->default(0);
            $table->text('note')->nullable();
            $table->string('karigar_id', 64)->nullable();
            $table->string('karigar_name')->default('');
            $table->double('advance_amount')->default(0);
            $table->boolean('advance_paid')->default(false);
            $table->string('created_at', 40)->nullable();
            $table->string('updated_at', 40)->nullable();
            $table->bigInteger('position')->default(0);
            $table->primary(['user_id', 'id']);
        });

        Schema::create('customers', function (Blueprint $table) {
            $table->string('user_id', 64);
            $table->string('id', 64);
            $table->string('name');
            $table->string('phone', 64)->default('');
            $table->string('email')->default('');
            $table->string('address')->default('');
            $table->string('created_at', 40)->nullable();
            $table->bigInteger('position')->default(0);
            $table->primary(['user_id', 'id']);
        });

        // Generic per-user JSON collections (same layout as supabase/pos-upgrade.sql).
        foreach (['karigars', 'gold_ledger', 'old_gold_exchanges', 'options', 'sales', 'repairs', 'schemes'] as $name) {
            Schema::create($name, function (Blueprint $table) {
                $table->string('user_id', 64);
                $table->string('id', 64);
                $table->json('data');
                $table->bigInteger('position')->default(0);
                $table->primary(['user_id', 'id']);
            });
        }

        // Global gold price history shared across all shops.
        Schema::create('shared_gold_rates', function (Blueprint $table) {
            $table->string('id', 32)->primary();
            $table->json('ticks')->nullable();
            $table->json('history')->nullable();
            $table->string('updated_at', 40)->nullable();
        });
    }

    public function down(): void
    {
        foreach ([
            'settings', 'items', 'transactions', 'orders', 'customers',
            'karigars', 'gold_ledger', 'old_gold_exchanges', 'options',
            'sales', 'repairs', 'schemes', 'shared_gold_rates',
        ] as $name) {
            Schema::dropIfExists($name);
        }
    }
};

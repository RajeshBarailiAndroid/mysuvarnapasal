<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The market gold price, one row per capture, kept forever.
 *
 * This is the reference price from the metal API (gold-api.com by default),
 * NOT the shop's own selling rate — that still lives in each shop's settings.
 * It is global: every shop sees the same market history. The old
 * shared_gold_rates JSON blob trimmed itself to 500 rows; this table is what
 * "full history" means, so it is a real table with a real index instead.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('gold_price_ticks')) return;
        Schema::create('gold_price_ticks', function (Blueprint $table) {
            $table->bigIncrements('id');
            /** When the price was captured (UTC). */
            $table->dateTime('captured_at')->index();
            /** Raw quote, in the API's currency (USD), per troy ounce. */
            $table->decimal('gold_usd_per_oz', 14, 4);
            $table->decimal('silver_usd_per_oz', 14, 4)->nullable();
            /** The exchange rate used to reach NPR, frozen with the row. */
            $table->decimal('npr_per_usd', 12, 4);
            /** What the shops actually read. */
            $table->decimal('gold_npr_per_tola', 14, 2);
            $table->decimal('gold_npr_per_gram', 14, 2);
            $table->decimal('silver_npr_per_tola', 14, 2)->nullable();
            $table->string('source', 40)->default('gold-api.com');
            /** The API's own timestamp for the quote, when it gave one. */
            $table->string('quote_at', 40)->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('gold_price_ticks');
    }
};

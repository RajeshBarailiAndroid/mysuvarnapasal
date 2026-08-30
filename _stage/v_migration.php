<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Two columns the items table was missing.
 *
 * `photo_path` is the new one: the path under public/ of the item's picture,
 * or null when it has none.
 *
 * `item_number` is a fix. ItemController::index has always handed ITM-0001,
 * ITM-0002 … to any item without a number, but Store::itemToRow never wrote
 * the value to a column — so the very next listing request read the field back
 * empty and renumbered the whole inventory again. Item numbers changed under
 * the shop's feet on every page load and settings.itemCounter climbed forever.
 * Giving the value a column makes that backfill run once and stay put.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('items', function (Blueprint $table) {
            $table->string('photo_path')->nullable();
            $table->string('item_number', 24)->default('');
        });
    }

    public function down(): void
    {
        Schema::table('items', function (Blueprint $table) {
            $table->dropColumn(['photo_path', 'item_number']);
        });
    }
};

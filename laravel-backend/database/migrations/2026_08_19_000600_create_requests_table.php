<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Customer item requests — same generic (user_id, id, data json) layout as
 * the other JSON collections in 2026_08_03_000100_create_pos_tables.php.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('requests')) return;
        Schema::create('requests', function (Blueprint $table) {
            $table->string('user_id', 64);
            $table->string('id', 64);
            $table->json('data');
            $table->bigInteger('position')->default(0);
            $table->primary(['user_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('requests');
    }
};

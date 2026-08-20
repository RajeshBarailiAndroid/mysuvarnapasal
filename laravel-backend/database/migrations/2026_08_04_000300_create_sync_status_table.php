<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sync_status', function (Blueprint $table) {
            $table->string('key', 128)->primary();
            $table->string('last_pushed_hash', 64)->nullable();
            $table->string('last_pushed_at', 40)->nullable();
            $table->text('last_error')->nullable();
            $table->string('last_error_at', 40)->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_status');
    }
};

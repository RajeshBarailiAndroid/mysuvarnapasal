<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// The market gold price, every 15 minutes, kept forever in gold_price_ticks.
// Needs the one system cron line Laravel always needs:
//   * * * * * cd /path/to/laravel-backend && php artisan schedule:run >> /dev/null 2>&1
// Without it, GET /api/gold-price still captures on demand when its newest
// row is older than 15 minutes, so the chart fills in while someone looks.
Schedule::command('pos:capture-gold-price')->everyFifteenMinutes()->withoutOverlapping();

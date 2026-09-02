<?php

namespace App\Console\Commands;

use App\Services\GoldPriceHistory;
use Illuminate\Console\Command;

/**
 * Store the current market gold price. Runs every 15 minutes from the
 * scheduler (routes/console.php) — or by hand:
 *
 *   php artisan pos:capture-gold-price
 */
class CaptureGoldPrice extends Command
{
    protected $signature = 'pos:capture-gold-price';
    protected $description = 'Fetch the live market gold price and add it to the history';

    public function handle(): int
    {
        try {
            $row = GoldPriceHistory::capture();
        } catch (\Throwable $err) {
            $this->error('Capture failed: ' . $err->getMessage());
            return self::FAILURE;
        }
        if ($row === null) {
            $this->warn('Live metal API is not configured (METAL_PRICE_PROVIDER); nothing stored.');
            return self::SUCCESS;
        }
        $this->info(sprintf(
            'Gold %s NPR/tola (%s NPR/g, USD %s/oz @ %s NPR/USD) at %s',
            number_format($row['goldPerTola'], 2), number_format($row['goldPerGram'], 2),
            number_format($row['goldUsdPerOz'], 2), $row['nprPerUsd'], $row['capturedAt']
        ));
        return self::SUCCESS;
    }
}

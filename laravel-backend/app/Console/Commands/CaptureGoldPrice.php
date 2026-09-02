<?php

namespace App\Console\Commands;

use App\Services\FxRates;
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
            // Refresh the exchange rate first: it is what turns the USD spot
            // price into the NPR figure stored below, and the same table the
            // clients convert with. Doing it here keeps the cache warm so a
            // shopkeeper signing in never waits on the FX provider.
            $fx = FxRates::refresh();
            $this->line(sprintf(
                'FX %s NPR/USD (%s%s)',
                $fx['rates']['USD'], $fx['source'], $fx['live'] ? '' : ', not live'
            ));
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

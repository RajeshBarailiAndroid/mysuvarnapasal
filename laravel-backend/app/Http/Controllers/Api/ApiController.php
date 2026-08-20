<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Store;
use Illuminate\Http\Request;

abstract class ApiController extends Controller
{
    public function __construct(protected Store $store)
    {
    }

    protected function userId(Request $request): string
    {
        return (string) $request->attributes->get('userId', Store::LOCAL_DEV_USER_ID);
    }

    protected function readStore(Request $request): array
    {
        return $this->store->read($this->userId($request));
    }

    protected function writeStore(Request $request, array $store): void
    {
        $this->store->write($this->userId($request), $store);
    }

    protected function fail(string $message, int $status = 400)
    {
        return response()->json(['error' => $message], $status);
    }
}

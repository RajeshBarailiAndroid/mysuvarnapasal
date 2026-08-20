<?php

use Illuminate\Support\Facades\Route;

// Desktop / single-server mode: when the POS frontend has been copied into
// public/ (public/index.html exists), serve it at the root.
Route::get('/', function () {
    $app = public_path('index.html');
    if (is_file($app)) {
        return response()->file($app);
    }
    return view('welcome');
});

// Public customer request link: /order/{code} serves ONLY customer.html — the
// standalone request page. It loads no shop scripts and needs no login; the
// code in the URL is what scopes it to one shop (see PublicRequestController).
Route::get('/order/{code?}', function (?string $code = null) {
    $page = public_path('customer.html');
    abort_unless(is_file($page), 404);
    return response()->file($page);
})->where('code', '[A-Za-z0-9]{0,64}');

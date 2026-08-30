<?php

namespace App\Http\Controllers\Api;

use App\Support\ItemPhoto;
use Illuminate\Http\Request;
use RuntimeException;

/**
 * The item picture: one upload route and one delete route.
 *
 * It is a separate request from creating the item on purpose. The phone apps
 * post the item first, get its id back, then send the photo — so a failed or
 * slow upload over a shop's patchy connection loses the picture, never the
 * item the counter staff just typed in.
 */
class ItemPhotoController extends ApiController
{
    public function store_(Request $request, string $id)
    {
        $store = $this->readStore($request);
        $idx = $this->indexOf($store, $id);
        if ($idx === null) {
            return $this->fail('Item not found.', 404);
        }

        $file = $request->file('photo');
        if ($file === null) {
            return $this->fail('No picture was attached.');
        }
        if (is_array($file)) {
            return $this->fail('Attach one picture at a time.');
        }

        try {
            $path = ItemPhoto::store($this->userId($request), $id, $file);
        } catch (RuntimeException $e) {
            return $this->fail($e->getMessage(), 422);
        }

        // Replacing a picture: the old file goes only once the new one is
        // safely written, so a failure halfway through leaves the old one.
        $previous = $store['items'][$idx]['photoPath'] ?? null;

        $store['items'][$idx]['photoPath'] = $path;
        $store['items'][$idx]['photoUrl'] = ItemPhoto::url($path);
        $this->writeStore($request, $store);

        if ($previous && $previous !== $path) {
            ItemPhoto::delete($previous);
        }

        return response()->json($store['items'][$idx]);
    }

    public function destroy(Request $request, string $id)
    {
        $store = $this->readStore($request);
        $idx = $this->indexOf($store, $id);
        if ($idx === null) {
            return $this->fail('Item not found.', 404);
        }

        $previous = $store['items'][$idx]['photoPath'] ?? null;
        $store['items'][$idx]['photoPath'] = null;
        $store['items'][$idx]['photoUrl'] = null;
        $this->writeStore($request, $store);

        ItemPhoto::delete($previous);

        return response()->json($store['items'][$idx]);
    }

    private function indexOf(array $store, string $id): ?int
    {
        foreach ($store['items'] as $i => $item) {
            if (($item['id'] ?? null) === $id) {
                return $i;
            }
        }
        return null;
    }
}

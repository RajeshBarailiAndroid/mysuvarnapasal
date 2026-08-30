<?php

namespace Tests\Feature;

use Tests\ApiTestCase;

/**
 * /api/items — the inventory CRUD the "add items" flow depends on.
 */
class ItemsTest extends ApiTestCase
{
    public function test_an_item_can_be_added_to_inventory(): void
    {
        $token = $this->signupToken();

        $item = $this->createItem($token, [
            'sku' => 'GC-100',
            'name' => 'Gold Chain 22K',
            'quantity' => 5,
        ]);

        $this->assertSame('GC-100', $item['sku']);
        $this->assertSame('Gold Chain 22K', $item['name']);
        $this->assertSame(5, (int) $item['quantity']);
        $this->assertNotEmpty($item['id']);
    }

    public function test_new_items_get_sequential_item_numbers(): void
    {
        $token = $this->signupToken();

        $first = $this->createItem($token, ['sku' => 'A-1', 'name' => 'Ring']);
        $second = $this->createItem($token, ['sku' => 'A-2', 'name' => 'Bangle']);
        $third = $this->createItem($token, ['sku' => 'A-3', 'name' => 'Earring']);

        $this->assertSame('ITM-0001', $first['itemNumber']);
        $this->assertSame('ITM-0002', $second['itemNumber']);
        $this->assertSame('ITM-0003', $third['itemNumber']);
    }

    /**
     * Regression: item numbers used to be reassigned on every listing request,
     * because the value was never written to a column. Two GETs in a row would
     * hand the same chain ITM-0001 and then ITM-0004.
     */
    public function test_item_numbers_do_not_change_when_the_inventory_is_listed(): void
    {
        $token = $this->signupToken();
        $this->createItem($token, ['sku' => 'A-1', 'name' => 'Ring']);
        $this->createItem($token, ['sku' => 'A-2', 'name' => 'Bangle']);

        $first = $this->withHeaders($this->bearer($token))->getJson('/api/items');
        $first->assertOk();
        $second = $this->withHeaders($this->bearer($token))->getJson('/api/items');
        $second->assertOk();

        $numbersOf = fn ($response) => collect($response->json('items'))
            ->sortBy('sku')->pluck('itemNumber')->values()->all();

        $this->assertSame(['ITM-0001', 'ITM-0002'], $numbersOf($first));
        $this->assertSame($numbersOf($first), $numbersOf($second));
    }

    public function test_name_and_sku_are_both_required(): void
    {
        $token = $this->signupToken();

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/items', ['name' => 'No SKU'])
            ->assertStatus(400)
            ->assertJsonPath('error', 'Name and SKU are required.');

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/items', ['sku' => 'NO-NAME'])
            ->assertStatus(400)
            ->assertJsonPath('error', 'Name and SKU are required.');
    }

    public function test_a_duplicate_sku_is_rejected(): void
    {
        $token = $this->signupToken();
        $this->createItem($token, ['sku' => 'DUP-1']);

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/items', [
                'sku' => 'DUP-1',
                'name' => 'Another Item',
                'quantity' => 1,
            ])
            ->assertStatus(400)
            ->assertJsonPath('error', 'SKU already exists.');
    }

    public function test_an_other_metal_item_needs_a_custom_rate_per_tola(): void
    {
        $token = $this->signupToken();

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/items', [
                'sku' => 'PLAT-1',
                'name' => 'Platinum Band',
                'category' => 'other',
                'quantity' => 1,
            ])
            ->assertStatus(400)
            ->assertJsonPath('error', 'Enter a rate per tola for Other metal items.');

        $this->withHeaders($this->bearer($token))
            ->postJson('/api/items', [
                'sku' => 'PLAT-1',
                'name' => 'Platinum Band',
                'category' => 'other',
                'customRatePerTola' => 250000,
                'quantity' => 1,
            ])
            ->assertCreated();
    }

    public function test_the_item_list_carries_the_shop_metal_rates(): void
    {
        $token = $this->signupToken();
        $this->createItem($token);

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/items')
            ->assertOk()
            ->assertJsonStructure(['items', 'goldRatePerTola', 'silverRatePerTola'])
            ->assertJsonCount(1, 'items');
    }

    public function test_items_can_be_searched_by_name_and_sku(): void
    {
        $token = $this->signupToken();
        $this->createItem($token, ['sku' => 'RING-9', 'name' => 'Wedding Ring']);
        $this->createItem($token, ['sku' => 'CHAIN-9', 'name' => 'Rope Chain']);

        $byName = $this->withHeaders($this->bearer($token))
            ->getJson('/api/items?q=wedding')->assertOk();
        $this->assertCount(1, $byName->json('items'));
        $this->assertSame('RING-9', $byName->json('items.0.sku'));

        $bySku = $this->withHeaders($this->bearer($token))
            ->getJson('/api/items?q=chain-9')->assertOk();
        $this->assertCount(1, $bySku->json('items'));

        $noMatch = $this->withHeaders($this->bearer($token))
            ->getJson('/api/items?q=zzzznothing')->assertOk();
        $this->assertCount(0, $noMatch->json('items'));
    }

    public function test_items_can_be_filtered_by_category_and_status(): void
    {
        $token = $this->signupToken();
        $this->createItem($token, ['sku' => 'G-1', 'category' => 'gold']);
        $this->createItem($token, ['sku' => 'S-1', 'category' => 'silver']);

        $silver = $this->withHeaders($this->bearer($token))
            ->getJson('/api/items?category=silver')->assertOk();

        $this->assertCount(1, $silver->json('items'));
        $this->assertSame('S-1', $silver->json('items.0.sku'));

        $inStock = $this->withHeaders($this->bearer($token))
            ->getJson('/api/items?status=in_stock')->assertOk();
        $this->assertCount(2, $inStock->json('items'));
    }

    public function test_a_single_item_can_be_fetched_by_id(): void
    {
        $token = $this->signupToken();
        $item = $this->createItem($token);

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/items/' . $item['id'])
            ->assertOk()
            ->assertJsonPath('sku', $item['sku']);
    }

    public function test_fetching_an_unknown_item_returns_404(): void
    {
        $token = $this->signupToken();

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/items/sp_does_not_exist')
            ->assertStatus(404)
            ->assertJsonPath('error', 'Item not found.');
    }

    public function test_an_item_can_be_updated(): void
    {
        $token = $this->signupToken();
        $item = $this->createItem($token, ['name' => 'Old Name', 'quantity' => 2]);

        $this->withHeaders($this->bearer($token))
            ->putJson('/api/items/' . $item['id'], [
                'name' => 'New Name',
                'quantity' => 7,
                'location' => 'Counter 2',
            ])
            ->assertOk()
            ->assertJsonPath('name', 'New Name')
            ->assertJsonPath('location', 'Counter 2');

        $this->assertSame(7, (int) $this->withHeaders($this->bearer($token))
            ->getJson('/api/items/' . $item['id'])->json('quantity'));
    }

    public function test_updating_keeps_the_original_item_number(): void
    {
        $token = $this->signupToken();
        $item = $this->createItem($token);

        $this->withHeaders($this->bearer($token))
            ->putJson('/api/items/' . $item['id'], ['name' => 'Renamed'])
            ->assertOk()
            ->assertJsonPath('itemNumber', $item['itemNumber']);
    }

    public function test_an_update_cannot_steal_another_items_sku(): void
    {
        $token = $this->signupToken();
        $this->createItem($token, ['sku' => 'TAKEN-1']);
        $second = $this->createItem($token, ['sku' => 'FREE-1']);

        $this->withHeaders($this->bearer($token))
            ->putJson('/api/items/' . $second['id'], ['sku' => 'TAKEN-1'])
            ->assertStatus(400)
            ->assertJsonPath('error', 'SKU already exists.');
    }

    public function test_a_blank_name_is_rejected_on_update(): void
    {
        $token = $this->signupToken();
        $item = $this->createItem($token);

        $this->withHeaders($this->bearer($token))
            ->putJson('/api/items/' . $item['id'], ['name' => '   '])
            ->assertStatus(400)
            ->assertJsonPath('error', 'Name is required.');
    }

    public function test_a_sold_out_item_cannot_be_edited(): void
    {
        $token = $this->signupToken();
        $item = $this->createItem($token, ['quantity' => 0, 'status' => 'sold_out']);

        $this->withHeaders($this->bearer($token))
            ->putJson('/api/items/' . $item['id'], ['name' => 'Trying to edit'])
            ->assertStatus(400)
            ->assertJsonPath('error', 'Sold out items cannot be edited.');
    }

    public function test_an_item_can_be_deleted(): void
    {
        $token = $this->signupToken();
        $item = $this->createItem($token);

        $this->withHeaders($this->bearer($token))
            ->deleteJson('/api/items/' . $item['id'])
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->withHeaders($this->bearer($token))
            ->getJson('/api/items/' . $item['id'])
            ->assertStatus(404);
    }

    public function test_deleting_an_unknown_item_returns_404(): void
    {
        $token = $this->signupToken();

        $this->withHeaders($this->bearer($token))
            ->deleteJson('/api/items/sp_nope')
            ->assertStatus(404);
    }
}

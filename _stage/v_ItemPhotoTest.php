<?php

namespace Tests\Feature;

use App\Support\ItemPhoto;
use Illuminate\Http\UploadedFile;
use Tests\ApiTestCase;

/**
 * /api/items/{id}/photo — the picture the phone apps attach when a scanned
 * barcode turns into a new item.
 *
 * These write real files under public/, so every test cleans up after itself.
 */
class ItemPhotoTest extends ApiTestCase
{
    /** @var list<string> absolute paths written during a test */
    private array $written = [];

    protected function tearDown(): void
    {
        foreach ($this->written as $path) {
            if (is_file($path)) {
                @unlink($path);
            }
        }
        $this->written = [];
        parent::tearDown();
    }

    private function track(?string $relative): void
    {
        if ($relative) {
            $this->written[] = public_path($relative);
        }
    }

    /** A real JPEG, not a text file with a .jpg name. */
    private function jpeg(int $width = 400, int $height = 300): UploadedFile
    {
        return UploadedFile::fake()->image('item.jpg', $width, $height);
    }

    public function test_a_picture_can_be_attached_to_an_item(): void
    {
        $token = $this->signupToken();
        $item = $this->createItem($token);

        $response = $this->withHeaders($this->bearer($token))
            ->post("/api/items/{$item['id']}/photo", ['photo' => $this->jpeg()]);

        $response->assertOk();
        $this->track($response->json('photoPath'));

        $this->assertNotEmpty($response->json('photoPath'));
        $this->assertNotEmpty($response->json('photoUrl'));
        $this->assertStringStartsWith('uploads/items/', $response->json('photoPath'));
        $this->assertFileExists(public_path($response->json('photoPath')));
    }

    public function test_the_picture_survives_a_reload_of_the_inventory(): void
    {
        $token = $this->signupToken();
        $item = $this->createItem($token);

        $upload = $this->withHeaders($this->bearer($token))
            ->post("/api/items/{$item['id']}/photo", ['photo' => $this->jpeg()]);
        $upload->assertOk();
        $this->track($upload->json('photoPath'));

        $list = $this->withHeaders($this->bearer($token))->getJson('/api/items');
        $list->assertOk();

        $this->assertSame($upload->json('photoPath'), $list->json('items.0.photoPath'));
        $this->assertNotEmpty($list->json('items.0.photoUrl'));
    }

    public function test_a_large_photo_is_scaled_down_to_the_cap(): void
    {
        $token = $this->signupToken();
        $item = $this->createItem($token);

        $response = $this->withHeaders($this->bearer($token))
            ->post("/api/items/{$item['id']}/photo", ['photo' => $this->jpeg(4000, 3000)]);
        $response->assertOk();
        $this->track($response->json('photoPath'));

        [$width, $height] = getimagesize(public_path($response->json('photoPath')));
        $this->assertSame(ItemPhoto::MAX_EDGE, $width);
        $this->assertLessThanOrEqual(ItemPhoto::MAX_EDGE, $height);
    }

    public function test_replacing_a_picture_removes_the_old_file(): void
    {
        $token = $this->signupToken();
        $item = $this->createItem($token);

        $first = $this->withHeaders($this->bearer($token))
            ->post("/api/items/{$item['id']}/photo", ['photo' => $this->jpeg()]);
        $first->assertOk();
        $firstPath = public_path($first->json('photoPath'));

        $second = $this->withHeaders($this->bearer($token))
            ->post("/api/items/{$item['id']}/photo", ['photo' => $this->jpeg(500, 500)]);
        $second->assertOk();
        $this->track($second->json('photoPath'));

        $this->assertNotSame($first->json('photoPath'), $second->json('photoPath'));
        $this->assertFileDoesNotExist($firstPath);
        $this->assertFileExists(public_path($second->json('photoPath')));
    }

    public function test_a_picture_can_be_removed(): void
    {
        $token = $this->signupToken();
        $item = $this->createItem($token);

        $upload = $this->withHeaders($this->bearer($token))
            ->post("/api/items/{$item['id']}/photo", ['photo' => $this->jpeg()]);
        $upload->assertOk();
        $path = public_path($upload->json('photoPath'));

        $response = $this->withHeaders($this->bearer($token))
            ->deleteJson("/api/items/{$item['id']}/photo");

        $response->assertOk();
        $this->assertNull($response->json('photoPath'));
        $this->assertFileDoesNotExist($path);
    }

    public function test_deleting_the_item_deletes_its_picture(): void
    {
        $token = $this->signupToken();
        $item = $this->createItem($token);

        $upload = $this->withHeaders($this->bearer($token))
            ->post("/api/items/{$item['id']}/photo", ['photo' => $this->jpeg()]);
        $upload->assertOk();
        $path = public_path($upload->json('photoPath'));

        $this->withHeaders($this->bearer($token))
            ->deleteJson("/api/items/{$item['id']}")
            ->assertOk();

        $this->assertFileDoesNotExist($path);
    }

    public function test_a_file_that_is_not_an_image_is_refused(): void
    {
        $token = $this->signupToken();
        $item = $this->createItem($token);

        $response = $this->withHeaders($this->bearer($token))->post(
            "/api/items/{$item['id']}/photo",
            ['photo' => UploadedFile::fake()->createWithContent('shell.jpg', '<?php echo "no"; ?>')]
        );

        $response->assertStatus(422);
        $this->assertStringContainsString('not a picture', strtolower((string) $response->json('error')));
    }

    public function test_a_shop_cannot_attach_a_picture_to_another_shops_item(): void
    {
        $ownerToken = $this->signupToken();
        $item = $this->createItem($ownerToken);

        $intruderToken = $this->signupToken([
            'username' => 'othershop',
            'email' => 'other@example.com',
        ]);

        $this->withHeaders($this->bearer($intruderToken))
            ->post("/api/items/{$item['id']}/photo", ['photo' => $this->jpeg()])
            ->assertNotFound();
    }

    public function test_editing_an_item_leaves_its_picture_alone(): void
    {
        $token = $this->signupToken();
        $item = $this->createItem($token);

        $upload = $this->withHeaders($this->bearer($token))
            ->post("/api/items/{$item['id']}/photo", ['photo' => $this->jpeg()]);
        $upload->assertOk();
        $this->track($upload->json('photoPath'));

        $response = $this->withHeaders($this->bearer($token))
            ->putJson("/api/items/{$item['id']}", ['name' => 'Renamed Chain']);

        $response->assertOk();
        $this->assertSame('Renamed Chain', $response->json('name'));
        $this->assertSame($upload->json('photoPath'), $response->json('photoPath'));
    }

    public function test_an_unauthenticated_request_cannot_upload(): void
    {
        $token = $this->signupToken();
        $item = $this->createItem($token);

        $this->post("/api/items/{$item['id']}/photo", ['photo' => $this->jpeg()])
            ->assertUnauthorized();
    }
}

<?php

namespace App\Support;

use Illuminate\Http\UploadedFile;
use RuntimeException;

/**
 * Where an item's picture lives, and how it gets there.
 *
 * Files are written to public/uploads/items/<shop>/<item>-<token>.jpg and
 * served by the web server as ordinary static files. That is deliberate: an
 * <img src> in the web app and a plain image loader in the two phone apps can
 * both fetch them without carrying an Authorization header, which no HTML
 * image tag and few image libraries can do.
 *
 * <shop> is a keyed hash of the user id, not the id itself, and <token> is 16
 * random hex characters, so a URL cannot be derived from an item id. It is
 * still a capability URL: anyone holding it can read that one picture. For
 * shelf photos of stock that is an acceptable trade for making the pictures
 * work everywhere; if it stops being acceptable, move this directory outside
 * public/ and serve it from an authenticated route instead.
 *
 * Uploads are re-encoded through GD rather than copied. That normalises the
 * format, drops EXIF (which carries the GPS location a photo was taken at),
 * caps the dimensions, and guarantees what lands on disk is an image and not a
 * PHP script wearing a .jpg extension.
 */
class ItemPhoto
{
    /** Long edge, in pixels. A gold item on a counter needs no more. */
    public const MAX_EDGE = 1600;

    public const JPEG_QUALITY = 82;

    /** Anything larger is refused before it is decoded. */
    public const MAX_BYTES = 12 * 1024 * 1024;

    public const BASE_DIR = 'uploads/items';

    /**
     * Re-encode the upload and write it. Returns the path relative to public/,
     * which is what goes in the item's `photoPath`.
     *
     * @throws RuntimeException with a message meant for the shop, not a log
     */
    public static function store(string $userId, string $itemId, UploadedFile $file): string
    {
        if (!$file->isValid()) {
            throw new RuntimeException('The picture did not upload completely. Try again.');
        }
        if ($file->getSize() > self::MAX_BYTES) {
            throw new RuntimeException('That picture is too large. Keep it under 12 MB.');
        }
        if (!function_exists('imagecreatefromstring')) {
            throw new RuntimeException('This server cannot process images (the GD extension is missing).');
        }

        $raw = @file_get_contents($file->getRealPath());
        if ($raw === false || $raw === '') {
            throw new RuntimeException('The picture could not be read.');
        }

        $image = @imagecreatefromstring($raw);
        if ($image === false) {
            throw new RuntimeException('That file is not a picture this server can read.');
        }

        try {
            $image = self::applyExifRotation($image, $file->getRealPath());
            $image = self::downscale($image);

            $dir = self::directory($userId);
            if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
                throw new RuntimeException('The server could not create the picture folder.');
            }
            self::protectDirectory();

            $name = self::safeSegment($itemId) . '-' . bin2hex(random_bytes(8)) . '.jpg';
            $absolute = $dir . DIRECTORY_SEPARATOR . $name;

            if (!imagejpeg($image, $absolute, self::JPEG_QUALITY)) {
                throw new RuntimeException('The picture could not be saved on the server.');
            }
            @chmod($absolute, 0644);

            return self::BASE_DIR . '/' . self::shopSegment($userId) . '/' . $name;
        } finally {
            imagedestroy($image);
        }
    }

    /** Quietly does nothing when the path is null or the file is already gone. */
    public static function delete(?string $relative): void
    {
        if (!$relative || !self::looksLikeOurPath($relative)) {
            return;
        }
        $absolute = public_path($relative);
        if (is_file($absolute)) {
            @unlink($absolute);
        }
    }

    /** Absolute URL for the item's picture, or null when it has none. */
    public static function url(?string $relative): ?string
    {
        if (!$relative || !self::looksLikeOurPath($relative)) {
            return null;
        }
        return rtrim(config('app.url') ?: url('/'), '/') . '/' . ltrim($relative, '/');
    }

    public static function directory(string $userId): string
    {
        return public_path(self::BASE_DIR . '/' . self::shopSegment($userId));
    }

    /**
     * A per-shop folder name that does not disclose the user id. Keyed with
     * APP_KEY so it cannot be recomputed by someone who knows a username.
     */
    private static function shopSegment(string $userId): string
    {
        return substr(hash_hmac('sha256', $userId, (string) config('app.key')), 0, 16);
    }

    /**
     * Never trust an id in a filename — ids reach the delete route straight
     * from the request path, and `..` in one would escape the folder.
     */
    private static function safeSegment(string $value): string
    {
        $clean = preg_replace('/[^A-Za-z0-9_-]/', '', $value) ?? '';
        return $clean !== '' ? substr($clean, 0, 64) : 'item';
    }

    /** Guards public_path() against a stored value pointing anywhere else. */
    private static function looksLikeOurPath(string $relative): bool
    {
        return str_starts_with($relative, self::BASE_DIR . '/')
            && !str_contains($relative, '..')
            && !str_contains($relative, "\0");
    }

    /**
     * Phone cameras record the sensor's orientation in EXIF instead of
     * rotating the pixels; GD reads the pixels, so without this a portrait
     * photo lands on its side.
     */
    private static function applyExifRotation(\GdImage $image, string $path): \GdImage
    {
        if (!function_exists('exif_read_data')) {
            return $image;
        }
        $exif = @exif_read_data($path);
        $orientation = (int) ($exif['Orientation'] ?? 0);
        $degrees = match ($orientation) {
            3 => 180,
            6 => -90,
            8 => 90,
            default => 0,
        };
        if ($degrees === 0) {
            return $image;
        }
        $rotated = @imagerotate($image, $degrees, 0);
        if ($rotated === false) {
            return $image;
        }
        imagedestroy($image);
        return $rotated;
    }

    /** Shrinks to MAX_EDGE on the long side. Never enlarges. */
    private static function downscale(\GdImage $image): \GdImage
    {
        $width = imagesx($image);
        $height = imagesy($image);
        $longest = max($width, $height);
        if ($longest <= self::MAX_EDGE || $longest === 0) {
            return $image;
        }

        $scale = self::MAX_EDGE / $longest;
        $target = imagecreatetruecolor((int) round($width * $scale), (int) round($height * $scale));
        if ($target === false) {
            return $image;
        }

        // JPEG has no alpha, so anything transparent would come out black.
        $white = imagecolorallocate($target, 255, 255, 255);
        imagefilledrectangle($target, 0, 0, imagesx($target) - 1, imagesy($target) - 1, $white);
        imagecopyresampled(
            $target, $image,
            0, 0, 0, 0,
            imagesx($target), imagesy($target), $width, $height
        );

        imagedestroy($image);
        return $target;
    }

    /**
     * Belt and braces on top of re-encoding: tell Apache never to run anything
     * in the upload tree, in case a future change stops re-encoding.
     */
    private static function protectDirectory(): void
    {
        $htaccess = public_path(self::BASE_DIR) . DIRECTORY_SEPARATOR . '.htaccess';
        if (is_file($htaccess)) {
            return;
        }
        @file_put_contents($htaccess, <<<'CONF'
        # Uploaded item pictures. Static files only — never execute anything here.
        php_flag engine off
        RemoveHandler .php .phtml .php3 .php4 .php5 .php7 .php8 .phar
        RemoveType .php .phtml .php3 .php4 .php5 .php7 .php8 .phar
        <IfModule mod_headers.c>
            Header set X-Content-Type-Options "nosniff"
        </IfModule>
        CONF);
    }
}

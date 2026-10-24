package ai.nuphos.sharefixture;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.graphics.Bitmap;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileNotFoundException;
import java.nio.charset.StandardCharsets;

/** Non-exported, read-only synthetic provider; the sender must grant access across UIDs. */
public class SyntheticShareProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }
    @Override public String getType(Uri uri) { return "image.png".equals(uri.getLastPathSegment()) ? "image/png" : "text/plain"; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        MatrixCursor result = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        result.addRow(new Object[]{uri.getLastPathSegment(), "oversize.txt".equals(uri.getLastPathSegment()) ? 104857601L : null});
        return result;
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read only");
        String name = uri.getLastPathSegment();
        if ("denied.txt".equals(name)) throw new SecurityException("Synthetic denied provider");
        if (!"fixture.txt".equals(name) && !"image.png".equals(name)) throw new FileNotFoundException("Unknown synthetic file");
        File file = new File(getContext().getCacheDir(), name);
        try (FileOutputStream output = new FileOutputStream(file)) {
            if ("image.png".equals(name)) {
                Bitmap bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888);
                try { bitmap.eraseColor(0xff008844); bitmap.compress(Bitmap.CompressFormat.PNG, 100, output); }
                finally { bitmap.recycle(); }
            } else output.write("Synthetic attachment bytes".getBytes(StandardCharsets.UTF_8));
        } catch (Exception failure) { throw new FileNotFoundException("Synthetic file unavailable"); }
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
}

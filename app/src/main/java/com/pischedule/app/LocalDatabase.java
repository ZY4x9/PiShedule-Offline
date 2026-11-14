package com.pischedule.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;
import org.json.JSONException;

/** Local schedule snapshot and appearance preferences, stored in SQLite. */
public final class LocalDatabase extends SQLiteOpenHelper {
    LocalDatabase(Context context) {
        super(context.getApplicationContext(), "pischedule.db", null, 1);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE schedule (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL, snapshot TEXT NOT NULL)");
        db.execSQL("CREATE TABLE preferences (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new IllegalStateException("Unsupported database upgrade");
    }

    @JavascriptInterface
    public String readSchedule() {
        try (Cursor cursor = getReadableDatabase().query("schedule", new String[]{"snapshot"},
                "id = 1", null, null, null, null)) {
            return cursor.moveToFirst() ? cursor.getString(0) : null;
        }
    }

    @JavascriptInterface
    public boolean saveSchedule(String snapshot, int expectedRevision) {
        try {
            ContentValues values = new ContentValues();
            values.put("id", 1);
            values.put("snapshot", snapshot);
            values.put("revision", new JSONObject(snapshot).getLong("revision"));
            SQLiteDatabase db = getWritableDatabase();
            if (expectedRevision == -1) {
                return db.insertWithOnConflict("schedule", null, values, SQLiteDatabase.CONFLICT_IGNORE) != -1;
            }
            return db.update("schedule", values, "id = 1 AND revision = ?",
                    new String[]{Integer.toString(expectedRevision)}) == 1;
        } catch (JSONException error) {
            return false;
        }
    }

    @JavascriptInterface
    public String readBackground() {
        try (Cursor cursor = getReadableDatabase().query("preferences", new String[]{"value"},
                "name = ?", new String[]{"background"}, null, null, null)) {
            return cursor.moveToFirst() ? cursor.getString(0) : "";
        }
    }

    @JavascriptInterface
    public boolean saveBackground(String image) {
        SQLiteDatabase db = getWritableDatabase();
        if (image.isEmpty()) {
            db.delete("preferences", "name = ?", new String[]{"background"});
            return true;
        }
        if (!image.startsWith("data:image/jpeg;base64,") || image.length() > 1500000) return false;
        ContentValues values = new ContentValues();
        values.put("name", "background");
        values.put("value", image);
        return db.insertWithOnConflict("preferences", null, values, SQLiteDatabase.CONFLICT_REPLACE) != -1;
    }
}

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationMaterial_userId_type_inputFingerprint_schemaVersion_key" ON "ApplicationMaterial"("userId", "type", "inputFingerprint", "schemaVersion");

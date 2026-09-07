# Fase 1: minifyEnabled esta en false (ver app/build.gradle), asi que este
# archivo no se ejercita hoy. Se deja preparado para cuando se active R8,
# porque el MSDK de DJI usa reflexion/JNI internamente y sin estas reglas
# `registerApp()` puede fallar en un build "release" aunque funcione en
# "debug" -- confirmar las reglas exactas contra el
# `consumer-rules.pro`/`proguard-rules.pro` que trae el AAR de
# `dji-sdk-v5-aircraft` antes de habilitar minify (no se pudo inspeccionar
# el contenido del AAR desde esta maquina).
-keep class dji.** { *; }
-keep class com.dji.** { *; }
-keep class com.cySdkyc.** { *; }
-keep class com.secneo.** { *; }
-dontwarn dji.**

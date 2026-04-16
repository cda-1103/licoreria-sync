const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function sincronizarTodo() {
  console.log("📡 Conectando con la API de Fina...");
  
  try {
    const response = await fetch('https://api.finapartner.com/api/inventory?pageSize=500', {
      headers: { 
        'X-Access-Token': process.env.FINA_TOKEN,
        'Accept': 'application/json',
        'Origin': 'https://bbtiendadelicores.finapartner.com',
        'Referer': 'https://bbtiendadelicores.finapartner.com/'
      }
    });

    const json = await response.json();
    
    if (!json.data || json.data.length === 0) {
      console.log("⚠️ Fina no devolvió productos.");
      console.log("🔍 Respuesta completa:", JSON.stringify(json, null, 2));
      return;
    }

    console.log(`📦 Encontrados ${json.data.length} productos en Fina.`);

    // --- PASO 1: Procesar Categorías sin Duplicados de Slug ---
    const rawCategories = json.data.map(p => (p.category || 'Sin Categoría').trim());
    
    // Usamos un Map para asegurar que cada "slug" sea único
    const categoriasUnicas = new Map();
    
    rawCategories.forEach(nombre => {
      // Normalizamos el slug: minúsculas, quitamos espacios extras y caracteres raros
      const slug = nombre.toLowerCase()
                         .trim()
                         .replace(/\s+/g, '-')
                         .replace(/[^a-z0-9-]/g, '');
      
      // Si el slug no existe en nuestro mapa, lo agregamos
      // Esto evita que "Ron" y "RON" intenten crear dos slugs iguales
      if (!categoriasUnicas.has(slug)) {
        categoriasUnicas.set(slug, nombre);
      }
    });

    console.log(`📂 Sincronizando ${categoriasUnicas.size} categorías únicas...`);
    
    const arrayCategorias = Array.from(categoriasUnicas).map(([slug, nombre]) => ({
      nombre: nombre,
      slug: slug
    }));

    const { data: catInsertadas, error: catError } = await supabase
      .from('categorias')
      .upsert(arrayCategorias, { onConflict: 'nombre' })
      .select();

    if (catError) {
      // Si falla por slug, intentamos upsert por slug
      console.log("⚠️ Falló por nombre, reintentando por slug...");
      const { data: catRetry, error: retryError } = await supabase
        .from('categorias')
        .upsert(arrayCategorias, { onConflict: 'slug' })
        .select();
      
      if (retryError) throw retryError;
      var finalCats = catRetry;
    } else {
      var finalCats = catInsertadas;
    }

    // Mapa para vincular productos
    const catMap = {};
    finalCats.forEach(c => {
      catMap[c.nombre.toLowerCase().trim()] = c.id;
    });

    // --- PASO 2: Productos ---
    const updates = json.data.map(prod => {
      const nombreCatKey = (prod.category || 'Sin Categoría').toLowerCase().trim();
      return {
        sku: prod._id,
        nombre: prod.name,
        descripcion: prod.description || '',
        precio_usd: prod.sellingPrice || 0,
        stock: prod.amount || 0,
        categoria_id: catMap[nombreCatKey],
        actualizado_en: new Date().toISOString()
      };
    });

    console.log(`📤 Actualizando ${updates.length} productos...`);
    
    const { error: prodError } = await supabase
      .from('productos')
      .upsert(updates, { onConflict: 'sku' });

    if (prodError) throw prodError;
    
    console.log("✅ ¡Sincronización exitosa!");

  } catch (err) {
    console.error("❌ ERROR CRÍTICO:", err.message);
  }
}

sincronizarTodo();
